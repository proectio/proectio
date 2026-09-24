import secretPlacementPolicy from "../config/secret-placement-policy.json";
import { cookie, createSession, readCookie, verifySession } from "./auth";
import { loadInventory, loadRepositoryDetails } from "./github";
import { listWorkerSecretNames } from "./cloudflare";
import { compareSecretNames } from "./secret-inventory";
import type { SecretPlacementPolicy } from "./secret-inventory";

interface Env {
  ASSETS: Fetcher;
  GITHUB_APP_ID: string;
  GITHUB_PRIVATE_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  OWNER_LOGIN: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_WORKER_NAME?: string;
  CLOUDFLARE_REPOSITORY?: string;
}

interface GitHubOAuthTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUser {
  login: string;
}

const sessionCookie = "proectio_session";
const oauthStateCookie = "proectio_oauth_state";

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(data, { status, headers: responseHeaders });
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secureCookies(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function callbackUrl(request: Request): string {
  return new URL("/auth/github/callback", new URL(request.url).origin).toString();
}

async function isAuthenticated(request: Request, env: Env): Promise<boolean> {
  return verifySession(readCookie(request, sessionCookie), env.OWNER_LOGIN, env.SESSION_SECRET);
}

async function beginGitHubAuth(request: Request, env: Env): Promise<Response> {
  const state = randomState();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", callbackUrl(request));
  authorize.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(oauthStateCookie, state, 10 * 60, secureCookies(request)),
    },
  });
}

async function finishGitHubAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, oauthStateCookie);

  if (!code || !state || !expectedState || state !== expectedState) {
    return json({ error: "Invalid OAuth callback state" }, 400);
  }

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(request),
    }),
  });

  const token = (await tokenResponse.json()) as GitHubOAuthTokenResponse;
  if (!token.access_token) {
    return json({ error: token.error_description ?? token.error ?? "GitHub OAuth failed" }, 401);
  }

  const userResponse = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Proectio",
    },
  });

  const user = (await userResponse.json()) as GitHubUser;
  if (!userResponse.ok || user.login.toLowerCase() !== env.OWNER_LOGIN.toLowerCase()) {
    return json({ error: "This GitHub account is not allowed to access Proectio" }, 403);
  }

  const session = await createSession(env.OWNER_LOGIN, env.SESSION_SECRET);
  const headers = new Headers({
    Location: "/",
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", cookie(sessionCookie, session, 12 * 60 * 60, secureCookies(request)));
  headers.append("Set-Cookie", cookie(oauthStateCookie, "", 0, secureCookies(request)));

  return new Response(null, { status: 302, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "proectio",
        githubAppConfigured: Boolean(env.GITHUB_APP_ID && env.GITHUB_CLIENT_ID),
      });
    }

    if (url.pathname === "/auth/github") return beginGitHubAuth(request, env);
    if (url.pathname === "/auth/github/callback") return finishGitHubAuth(request, env);

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": cookie(sessionCookie, "", 0, secureCookies(request)) },
      });
    }

    if (url.pathname === "/api/session") {
      return json({ authenticated: await isAuthenticated(request, env) });
    }

    if (url.pathname === "/api/inventory") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Unauthorized" }, 401);

      try {
        return json({ installations: await loadInventory(env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY) });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown inventory error";
        return json({ error: message }, 502);
      }
    }

    if (url.pathname === "/api/secret-inventory") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Unauthorized" }, 401);

      const installationId = Number(url.searchParams.get("installationId"));
      const fullName = url.searchParams.get("repo") ?? "";
      if (!Number.isInteger(installationId) || installationId <= 0 || !/^[^/]+\/[^/]+$/.test(fullName)) {
        return json({ error: "Invalid secret inventory request" }, 400);
      }

      try {
        const githubDetails = await loadRepositoryDetails(
          env.GITHUB_APP_ID,
          env.GITHUB_PRIVATE_KEY,
          installationId,
          fullName,
        );
        const githubNames = [
          ...githubDetails.secrets.map((secret) => secret.name),
          ...githubDetails.environments.flatMap((environment) => environment.secrets.map((secret) => secret.name)),
        ];

        const cloudflareConfigured = Boolean(
          env.CLOUDFLARE_ACCOUNT_ID &&
          env.CLOUDFLARE_API_TOKEN &&
          env.CLOUDFLARE_WORKER_NAME &&
          env.CLOUDFLARE_REPOSITORY === fullName,
        );

        if (!cloudflareConfigured) {
          return json({
            githubNames: [...new Set(githubNames)].sort(),
            cloudflareNames: [],
            comparison: compareSecretNames(
              githubNames,
              [],
              (secretPlacementPolicy.repositories[fullName as keyof typeof secretPlacementPolicy.repositories] ?? {}) as SecretPlacementPolicy,
            ),
            cloudflare: { configured: false },
          });
        }

        const cloudflareSecrets = await listWorkerSecretNames(
          env.CLOUDFLARE_ACCOUNT_ID!,
          env.CLOUDFLARE_API_TOKEN!,
          env.CLOUDFLARE_WORKER_NAME!,
        );
        const cloudflareNames = cloudflareSecrets.map((secret) => secret.name);

        return json({
          githubNames: [...new Set(githubNames)].sort(),
          cloudflareNames: [...new Set(cloudflareNames)].sort(),
          comparison: compareSecretNames(
            githubNames,
            cloudflareNames,
            (secretPlacementPolicy.repositories[fullName as keyof typeof secretPlacementPolicy.repositories] ?? {}) as SecretPlacementPolicy,
          ),
          cloudflare: {
            configured: true,
            worker: env.CLOUDFLARE_WORKER_NAME,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown secret inventory error";
        return json({ error: message }, 502);
      }
    }

    if (url.pathname === "/api/repository-details") {
      if (!(await isAuthenticated(request, env))) return json({ error: "Unauthorized" }, 401);

      const installationId = Number(url.searchParams.get("installationId"));
      const fullName = url.searchParams.get("repo") ?? "";
      if (!Number.isInteger(installationId) || installationId <= 0 || !/^[^/]+\/[^/]+$/.test(fullName)) {
        return json({ error: "Invalid repository details request" }, 400);
      }

      try {
        return json({
          details: await loadRepositoryDetails(
            env.GITHUB_APP_ID,
            env.GITHUB_PRIVATE_KEY,
            installationId,
            fullName,
          ),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown repository details error";
        return json({ error: message }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
