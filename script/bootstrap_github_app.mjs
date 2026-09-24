#!/usr/bin/env node
// Proectio GitHub App bootstrap.
//
// The desired app is the organization-owned ProectioHQ registered from
// config/github-app-manifest.json. Default mode verifies that specific app and
// refuses to create a duplicate only when a verified matching app exists.
//
// Committed GITHUB_APP_ID / GITHUB_CLIENT_ID are legacy/ReporyHQ identifiers
// and are NOT treated as proof that the desired app exists. When they do not
// belong to the desired organization-owned app, --create treats them as stale
// bootstrap state, prints what will be replaced, and (unless --force is given)
// asks for interactive confirmation before replacing them.
//
// Generated credentials are never printed and are transferred straight into
// the target secret store (Cloudflare Worker Secrets, or a local .dev.vars).

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "config", "github-app-manifest.json");
const STATE_PATH = join(ROOT, "config", "github-app-state.json");
const WRANGLER_PATH = join(ROOT, "wrangler.jsonc");
const DEV_VARS_PATH = join(ROOT, ".dev.vars");

const DEFAULT_PORT = 4567;
const FLOW_TIMEOUT_MS = 15 * 60 * 1000;

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function log(step, message) {
  console.log(`[bootstrap-github-app] ${step}: ${message}`);
}

function relativeToRoot(path) {
  return relative(ROOT, path) || ".";
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readJson(path) {
  const raw = readText(path);
  return raw ? JSON.parse(raw) : null;
}

function slugify(value) {
  return String(value)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function safeEqual(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function openBrowser(url) {
  if (process.platform === "darwin") spawn("open", [url]);
  else if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url]);
  else spawn("xdg-open", [url]);
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...options });
}

function ghApi(pathParts) {
  const parts = Array.isArray(pathParts) ? pathParts : [pathParts];
  const path = parts.join("/").replace(/^\/+/, "");
  const result = run("gh", ["api", path, "--jq", "."]);
  if (result.status !== 0) {
    const body = (result.stdout || result.stderr || "").trim();
    const error = new Error(`gh api ${path} failed`);
    error.apiMessage = body || `exit code ${result.status}`;
    throw error;
  }
  return JSON.parse(result.stdout);
}

function requireGh() {
  const version = run("gh", ["--version"]);
  if (version.status !== 0) {
    fail("gh CLI is not installed. Install it and authenticate with `gh auth login`.");
  }
  if (run("gh", ["auth", "status"]).status !== 0) {
    fail("gh is not authenticated. Run `gh auth login` first.");
  }
  return true;
}

function activeGhUser() {
  const result = run("gh", ["api", "user", "--jq", ".login"]);
  if (result.status !== 0 || !result.stdout.trim()) {
    fail("could not read the active gh identity");
  }
  return result.stdout.trim();
}

function defaultRepo() {
  const result = run("gh", ["repo", "view", "--json", "nameWithOwner"]);
  if (result.status !== 0) return null;
  try {
    const json = JSON.parse(result.stdout);
    if (!json || !json.nameWithOwner || !json.nameWithOwner.includes("/")) return null;
    const [owner, name] = json.nameWithOwner.split("/");
    return { owner, name };
  } catch {
    return null;
  }
}

function wranglerVars() {
  const raw = readText(WRANGLER_PATH);
  if (!raw) return {};
  const vars = {};
  for (const match of raw.matchAll(/"([A-Z][A-Z0-9_]+)"\s*:\s*"([^"]*)"/g)) {
    vars[match[1]] = match[2];
  }
  return vars;
}

function workerNameFromConfig() {
  const raw = readText(WRANGLER_PATH);
  const match = raw && raw.match(/"name"\s*:\s*"([^"]+)"/);
  return match ? match[1] : "proectio";
}

function loadManifest() {
  const manifest = readJson(MANIFEST_PATH);
  if (!manifest) fail(`manifest not found: ${MANIFEST_PATH}`);
  for (const key of ["name", "url", "redirect_url"]) {
    const value = manifest[key];
    if (typeof value !== "string" || !value || /\{\{[^}]+\}\}/.test(value)) {
      fail(`manifest field "${key}" is missing or still contains a placeholder`);
    }
  }
  if (!manifest.default_permissions || typeof manifest.default_permissions !== "object") {
    fail('manifest field "default_permissions" must be an object');
  }
  for (const [name, level] of Object.entries(manifest.default_permissions)) {
    if (!["read", "write", "none"].includes(level)) {
      fail(`manifest permission "${name}" has invalid level "${level}"`);
    }
  }
  if (manifest.default_events && !Array.isArray(manifest.default_events)) {
    fail('manifest field "default_events" must be an array');
  }
  return manifest;
}

function detectExistingApp() {
  const vars = wranglerVars();
  const state = readJson(STATE_PATH);
  const appId = vars.GITHUB_APP_ID || (state && state.appId ? String(state.appId) : null);
  const clientId = vars.GITHUB_CLIENT_ID || (state && state.clientId) || null;
  if (!appId || !clientId) return null;
  return { appId, clientId };
}

function formatPermissions(permissions) {
  const entries = Object.entries(permissions || {});
  return entries.length ? entries.map(([key, level]) => `${key}: ${level}`).join(", ") : "none";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseArgs(argv) {
  const options = {
    create: false,
    force: false,
    syncCloudflare: false,
    overwriteDevVars: false,
    port: DEFAULT_PORT,
    org: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--create") options.create = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--sync-cloudflare") options.syncCloudflare = true;
    else if (arg === "--overwrite-dev-vars") options.overwriteDevVars = true;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--org") options.org = argv[++index];
    else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  process.stdout.write(`Proectio GitHub App bootstrap

Usage:
  node script/bootstrap_github_app.mjs             verify the DESIRED org-owned ProectioHQ app (default, never creates)
  node script/bootstrap_github_app.mjs --create    register the desired app from config/github-app-manifest.json

Options:
  --create              register a new GitHub App through the manifest flow
  --force               with --create: skip confirmation when replacing stale legacy identifiers
                        (committed App ID/Client ID that are NOT the desired org app)
  --sync-cloudflare     store generated secrets in Cloudflare Worker Secrets via wrangler
  --overwrite-dev-vars  with local secret storage: replace an existing .dev.vars
  --org <LOGIN>         register the app under an organization account
  --port <PORT>         localhost callback port (default ${DEFAULT_PORT})
  -h, --help            show this help

Runtime secrets are never printed. Without --sync-cloudflare they are written
to .dev.vars (mode 0600, gitignored) for local development only.
`);
}

function appBySlug(slug) {
  if (!slug) return null;
  try {
    return ghApi(["apps", slug]);
  } catch {
    return null;
  }
}

function desiredAppMatches(app, owner, committedClientId) {
  if (!app || !app.client_id || !app.owner) return false;
  const expectedType = owner.kind === "organization" ? "Organization" : "User";
  if (app.owner.type !== expectedType || app.owner.login !== owner.login) return false;
  if (committedClientId && app.client_id !== committedClientId) return false;
  return true;
}

async function verifyDesiredApp(manifest, owner, committed) {
  const slug = slugify(manifest.name);
  const app = appBySlug(slug);
  const matches = desiredAppMatches(app, owner, committed ? committed.clientId : null);

  console.log("");
  if (matches) {
    console.log(`${manifest.name} (App ID ${app.id}, Client ID ${app.client_id}) is verified under ${owner.kind} ${owner.login}.`);
    console.log("Verifying only; not creating a duplicate GitHub App.");
    console.log("");
    log("verify", `owner: ${app.owner.login} (${app.owner.type})`);
    log("verify", `app page: ${app.html_url || `https://github.com/apps/${slug}`}`);
    log("verify", `declared permissions: ${formatPermissions(manifest.default_permissions)}`);
    log("verify", `declared events: ${(manifest.default_events || []).join(", ") || "none"}`);
    console.log("");
    return;
  } else if (app) {
    console.log(`apps/${slug} resolves to "${app.name}" owned by ${app.owner.login} (${app.owner.type}) — that is NOT the desired ${owner.kind} ${owner.login} ${manifest.name} app.`);
    if (committed && committed.clientId !== app.client_id) {
      console.log(`The committed Client ID ${committed.clientId} does not match that app either.`);
    }
  } else {
    console.log(`No GitHub App resolves at apps/${slug}.`);
    console.log(`The desired ${owner.kind === "organization" ? "organization-owned" : "user-owned"} ${manifest.name} (owner ${owner.login}) does not exist yet.`);
  }

  if (committed) {
    console.log("");
    console.log("Committed identifiers present, but they are NOT proof the desired app exists:");
    console.log(`  App ID ${committed.appId}, Client ID ${committed.clientId}`);
    console.log("  These are stale legacy bootstrap state (ReporyHQ, user-owned by sergii).");
    console.log("  Do not delete that legacy app here; register it for separate removal instead.");
  }

  console.log("");
  console.log("Register the desired app with:");
  console.log(`  npm run bootstrap:github-app -- --create${owner.kind === "organization" ? ` --org ${owner.login}` : ""} --sync-cloudflare`);
  console.log("");
  console.log("Manual obligations after registration:");
  console.log("  1. Install the app on the target account(s) so the Worker has an installation.");
  console.log("  2. After the Worker has a public workers.dev URL, add the production OAuth");
  console.log("     callback URL /auth/github/callback in the app settings.");
  console.log("");
}

function startPageHtml({ manifestJson, registrationUrl, state, ownerLabel, appName }) {
  const action = `${registrationUrl}?state=${encodeURIComponent(state)}`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    "<title>Register Proectio GitHub App</title>",
    "<style>body{font-family:system-ui,sans-serif;max-width:600px;margin:48px auto;",
    "line-height:1.5;color:#1f2328}h1{font-size:1.4rem}code{background:#f6f8fa;",
    "padding:2px 4px;border-radius:4px}button{font-size:1rem;padding:10px 18px;cursor:pointer}",
    "</style></head><body>",
    "<h1>Register Proectio GitHub App</h1>",
    `<p>This registers a <strong>new</strong> GitHub App named <strong>${escapeHtml(appName)}</strong>`,
    `on ${escapeHtml(ownerLabel)} using the committed manifest <code>config/github-app-manifest.json</code>.</p>`,
    "<p>You will confirm the app once on GitHub. After that you return here automatically</p>",
    '<form action="' + action + '" method="POST">',
    '<input type="hidden" name="manifest" value="' + escapeHtml(manifestJson) + '">',
    '<button type="submit">Continue to GitHub</button>',
    "</form>",
    "<script>setTimeout(function(){document.forms[0].submit();},500);</script>",
    "</body></html>",
    "",
  ].join("\n");
}

function convertManifestCode(code) {
  const result = run("gh", [
    "api",
    "--method",
    "POST",
    "-H",
    "Accept: application/vnd.github+json",
    `/app-manifests/${code}/conversions`,
    "--jq",
    ".",
  ]);
  if (result.status !== 0) {
    const body = (result.stdout || result.stderr || "").trim();
    throw new Error(`manifest code conversion failed: ${body || `exit code ${result.status}`}`);
  }
  let conversion;
  try {
    conversion = JSON.parse(result.stdout);
  } catch {
    throw new Error("manifest code conversion returned non-JSON output");
  }
  if (!conversion || !conversion.id || !conversion.client_id || !conversion.client_secret || !conversion.pem) {
    throw new Error("manifest conversion response was missing required fields; aborting");
  }
  return conversion;
}

function runManifestFlow({ manifest, registrationUrl, state, port, ownerLabel }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const manifestJson = JSON.stringify(manifest, null, 2);
    const timeout = setTimeout(() => {
      server.close();
      rejectPromise(new Error("manifest flow timed out; no callback received"));
    }, FLOW_TIMEOUT_MS);

    const server = createServer((req, res) => {
      let url = null;
      try {
        url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
      } catch {
        url = null;
      }

      const send = (status, body, type = "text/plain; charset=utf-8") => {
        if (res.writableEnded) return;
        res.writeHead(status, { "Content-Type": type });
        res.end(body);
      };

      if (!url) {
        send(400, "Bad request");
        return;
      }

      if (req.method === "GET" && url.pathname === "/start") {
        send(200, startPageHtml({ manifestJson, registrationUrl, state, ownerLabel, appName: manifest.name }), "text/html; charset=utf-8");
        log("flow", `start page served at http://127.0.0.1:${port}/start`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/github-app-manifest/callback") {
        const code = url.searchParams.get("code");
        const returnedState = url.searchParams.get("state");
        if (!safeEqual(returnedState, state)) {
          send(400, "Callback state mismatch. Aborting.");
          return;
        }
        if (!code) {
          send(400, "Missing manifest code. Aborting.");
          return;
        }
        log("flow", "manifest callback received; converting the temporary code");
        let conversion;
        try {
          conversion = convertManifestCode(code);
        } catch (error) {
          clearTimeout(timeout);
          server.close();
          rejectPromise(error);
          send(500, "Manifest code conversion failed. See the terminal output.");
          return;
        }
        send(200, "Proectio GitHub App registered. Return to the terminal.");
        clearTimeout(timeout);
        server.close();
        resolvePromise({ conversion });
        return;
      }

      send(404, "Not found");
    });

    server.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });

    server.listen(port, "127.0.0.1", () => {
      log("flow", `local callback server listening on http://127.0.0.1:${port}`);
      openBrowser(`http://127.0.0.1:${port}/start`);
    });
  });
}

async function resolveOwner(org) {
  if (org) {
    try {
      ghApi(["orgs", org]);
    } catch (error) {
      fail(`cannot read organization "${org}": ${error.apiMessage || error.message}`);
    }
    return { kind: "organization", login: org };
  }
  const repo = defaultRepo();
  if (repo) {
    try {
      const info = ghApi(["repos", `${repo.owner}/${repo.name}`]);
      if (info.owner && info.owner.type === "Organization") {
        return { kind: "organization", login: info.owner.login };
      }
    } catch {
      // fall through to personal-account ownership
    }
  }
  return { kind: "user", login: activeGhUser() };
}

async function confirmReplace() {
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolvePromise) => {
    rl.question('Committed App ID/Client ID are stale legacy state and will be replaced. Type "replace" to continue: ', resolvePromise);
  });
  rl.close();
  if (answer.trim() !== "replace") fail("confirmation did not match; aborting without creating an app");
}

function updateWranglerIds(appId, clientId) {
  const raw = readText(WRANGLER_PATH);
  if (!raw) fail(`cannot read ${relativeToRoot(WRANGLER_PATH)}`);
  const next = raw
    .replace(/("GITHUB_APP_ID"\s*:\s*")[^"]*(")/, `$1${appId}$2`)
    .replace(/("GITHUB_CLIENT_ID"\s*:\s*")[^"]*(")/, `$1${clientId}$2`);
  if (next === raw) {
    fail(`could not update ${relativeToRoot(WRANGLER_PATH)}: GITHUB_APP_ID / GITHUB_CLIENT_ID vars not found`);
  }
  writeFileSync(WRANGLER_PATH, next);
  const vars = wranglerVars();
  if (vars.GITHUB_APP_ID !== appId || vars.GITHUB_CLIENT_ID !== clientId) {
    fail(`${relativeToRoot(WRANGLER_PATH)} update did not stick`);
  }
  log("persist", `updated ${relativeToRoot(WRANGLER_PATH)} with App ID and Client ID`);
}

function writeState(record) {
  writeFileSync(STATE_PATH, JSON.stringify(record, null, 2) + "\n");
  log("persist", `wrote non-secret identifiers to ${relativeToRoot(STATE_PATH)}`);
}

function persistIdentifiers(conversion, manifest, legacy, owner) {
  const appId = String(conversion.id);
  const clientId = conversion.client_id;
  const slug = conversion.slug || slugify(conversion.name || manifest.name);
  const ownerLogin = (conversion.account && conversion.account.login) || (owner && owner.login) || null;
  const ownerType =
    (conversion.account && conversion.account.type) ||
    (owner && (owner.kind === "organization" ? "Organization" : "User")) ||
    null;
  updateWranglerIds(appId, clientId);
  const record = {
    name: conversion.name || manifest.name,
    slug,
    appId,
    clientId,
    ownerLogin,
    ownerType,
    createdAt: new Date().toISOString(),
  };
  if (legacy) {
    record.replacedLegacy = {
      appId: legacy.appId,
      clientId: legacy.clientId,
      note: "previous committed identifiers were not the desired app; superseded here, legacy app left intact for manual removal",
    };
  }
  writeState(record);
  return { appId, clientId, slug, ownerLogin, ownerType };
}

function wranglerBin() {
  const local = join(ROOT, "node_modules", ".bin", "wrangler");
  return existsSync(local) ? local : "npx";
}

function putWranglerSecret(workerName, name, value) {
  return new Promise((resolvePromise, rejectPromise) => {
    const bin = wranglerBin();
    const args =
      bin === "npx"
        ? ["wrangler", "secret", "put", name, "--name", workerName]
        : ["secret", "put", name, "--name", workerName];
    const child = spawn(bin, args, { stdio: ["pipe", "inherit", "inherit"] });
    child.stdin.on("error", () => {});
    child.stdin.end(value);
    child.on("exit", (code) => {
      if (code === 0) {
        log("secrets", `stored ${name} in Cloudflare Worker Secrets for "${workerName}"`);
        resolvePromise();
      } else {
        rejectPromise(
          new Error(
            `wrangler secret put ${name} exited with ${code}; remove the partial value before retrying, or store it manually`,
          ),
        );
      }
    });
  });
}

function writeDevVars(secrets) {
  if (existsSync(DEV_VARS_PATH)) {
    fail(
      `${relativeToRoot(DEV_VARS_PATH)} already exists; pass --overwrite-dev-vars to replace it, or use --sync-cloudflare`,
    );
  }
  const pem = secrets.pem.replace(/\n/g, "\\n");
  const content = [
    "# Local development only. Production credentials belong in Cloudflare Worker Secrets.",
    `GITHUB_PRIVATE_KEY="${pem}"`,
    `GITHUB_CLIENT_SECRET="${secrets.clientSecret}"`,
    `SESSION_SECRET="${secrets.sessionSecret}"`,
    "",
  ].join("\n");
  writeFileSync(DEV_VARS_PATH, content, { mode: 0o600 });
  chmodSync(DEV_VARS_PATH, 0o600);
  log("secrets", `wrote local development secrets to ${relativeToRoot(DEV_VARS_PATH)} (mode 0600, gitignored)`);
}

async function storeSecrets(secrets, options) {
  if (options.syncCloudflare) {
    const workerName = workerNameFromConfig();
    log("secrets", `transferring generated secrets to Cloudflare Worker Secrets for "${workerName}"`);
    await putWranglerSecret(workerName, "GITHUB_CLIENT_SECRET", secrets.clientSecret);
    await putWranglerSecret(workerName, "GITHUB_PRIVATE_KEY", secrets.pem);
    await putWranglerSecret(workerName, "SESSION_SECRET", secrets.sessionSecret);
    return { workerName };
  }
  const overwritten = existsSync(DEV_VARS_PATH);
  if (overwritten && !options.overwriteDevVars) {
    fail(`${relativeToRoot(DEV_VARS_PATH)} already exists; pass --overwrite-dev-vars or --sync-cloudflare`);
  }
  writeDevVars(secrets);
  return { workerName: null };
}

function verifyNewApp(slug) {
  if (!slug) {
    log("verify", "no slug available; skipping API re-verification");
    return;
  }
  try {
    const app = ghApi(["apps", slug]);
    log("verify", `created app resolves via GitHub API: ${app.html_url || `https://github.com/apps/${slug}`}`);
  } catch {
    log(
      "verify",
      "could not resolve the new app via API yet; App ID / Client ID were persisted from GitHub's conversion response",
    );
  }
}

function printCreateSummary(manifest, ids, owner, store) {
  console.log("");
  console.log(`Created GitHub App ${manifest.name}:`);
  console.log(`  App ID     : ${ids.appId}`);
  console.log(`  Client ID  : ${ids.clientId}`);
  console.log(`  Slug       : ${ids.slug || "-"}`);
  console.log(`  Owner      : ${owner.kind === "organization" ? `organization ${owner.login}` : `user ${owner.login}`}`);
  console.log(`  Permissions: ${formatPermissions(manifest.default_permissions)}`);
  console.log(`  Events     : ${(manifest.default_events || []).join(", ") || "none"}`);
  console.log("");
  console.log("Non-secret identifiers persisted to:");
  console.log(`  - ${relativeToRoot(WRANGLER_PATH)} (vars GITHUB_APP_ID and GITHUB_CLIENT_ID)`);
  console.log(`  - ${relativeToRoot(STATE_PATH)}`);
  console.log("");
  console.log(
    store.workerName
      ? `Runtime secrets stored in Cloudflare Worker Secrets for "${store.workerName}".`
      : `Runtime secrets stored in ${relativeToRoot(DEV_VARS_PATH)} (local development only). Use --sync-cloudflare for production.`,
  );
  console.log("");
  console.log("Remaining one-time manual steps:");
  console.log("  1. Install the app on the target account(s) so the Worker has an installation.");
  console.log("  2. After the Worker has a public workers.dev URL, add the production OAuth");
  console.log("     callback URL /auth/github/callback in the app settings.");
  console.log("");
}

async function createNew(manifest, committed, options) {
  const owner = await resolveOwner(options.org);
  const slug = slugify(manifest.name);
  const desired = appBySlug(slug);

  if (desiredAppMatches(desired, owner, committed ? committed.clientId : null)) {
    console.error(`error: ${manifest.name} already exists under ${owner.kind} ${owner.login} (App ID ${desired.id}, Client ID ${desired.client_id}).`);
    console.error("Refusing to register a duplicate; use the default verify mode instead.");
    process.exit(1);
  }
  if (desired) {
    console.error(`error: apps/${slug} resolves to "${desired.name}" owned by ${desired.owner.login} (${desired.owner.type}).`);
    console.error(`That is not the configured legacy identity, and it is not the desired ${owner.login} ${owner.kind} app.`);
    console.error("Refusing to clobber an app we did not verify; resolve ownership manually first.");
    process.exit(1);
  }

  let replacingLegacy = null;
  if (committed) {
    replacingLegacy = { appId: committed.appId, clientId: committed.clientId };
    console.log("");
    log("create", `committed App ID ${committed.appId}, Client ID ${committed.clientId} do NOT belong to the desired ${owner.login} ${owner.kind} app`);
    log("create", "treating them as stale legacy bootstrap state; they will be replaced in config after registration");
    log("create", "the legacy app itself is left intact and must be removed separately (see docs/bootstrap.md)");
    if (!options.force) await confirmReplace();
  }

  const registrationUrl =
    owner.kind === "organization"
      ? `https://github.com/organizations/${owner.login}/settings/apps/new`
      : "https://github.com/settings/apps/new";
  const state = randomBytes(24).toString("hex");
  const ownerLabel =
    owner.kind === "organization" ? `the ${owner.login} organization` : `your personal account (${owner.login})`;

  const submitManifest = {
    ...manifest,
    redirect_url: `http://127.0.0.1:${options.port}/github-app-manifest/callback`,
  };

  let flow;
  try {
    flow = await runManifestFlow({
      manifest: submitManifest,
      registrationUrl,
      state,
      port: options.port,
      ownerLabel,
    });
  } catch (error) {
    if (error && error.code === "EADDRINUSE") {
      fail(`port ${options.port} is already in use; pick another with --port`);
    }
    fail(error.message);
  }

  const conversion = flow.conversion;
  const secrets = {
    clientSecret: conversion.client_secret,
    pem: conversion.pem,
    sessionSecret: randomBytes(48).toString("base64"),
  };

  try {
    const ids = persistIdentifiers(conversion, manifest, replacingLegacy, owner);
    const store = await storeSecrets(secrets, options);
    verifyNewApp(ids.slug);
    printCreateSummary(manifest, ids, owner, store);
  } finally {
    for (const key of Object.keys(secrets)) secrets[key] = "";
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) {
    fail("--port must be an integer between 1024 and 65535");
  }
  if (options.syncCloudflare && options.overwriteDevVars) {
    fail("--sync-cloudflare and --overwrite-dev-vars are mutually exclusive");
  }

  requireGh();
  const manifest = loadManifest();

  if (!options.create) {
    const owner = await resolveOwner(options.org);
    await verifyDesiredApp(manifest, owner, detectExistingApp());
    return;
  }

  await createNew(manifest, detectExistingApp(), options);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}