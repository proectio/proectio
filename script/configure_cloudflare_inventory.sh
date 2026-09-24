#!/usr/bin/env bash
set -euo pipefail

WORKER="proectio"
REPOSITORY="proectio/proectio"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
DEPLOY=false

usage() {
  cat <<'EOF'
Configure Proectio Cloudflare inventory access.

Usage:
  script/configure_cloudflare_inventory.sh [options]

Options:
  --worker NAME         Cloudflare Worker name (default: proectio)
  --repository OWNER/REPO
                        Repository mapped to the Worker (default: proectio/proectio)
  --account-id ID       Cloudflare account ID (otherwise auto-detect)
  --deploy              Deploy after npm run check
  -h, --help            Show this help

Token behavior:
  - If CLOUDFLARE_API_TOKEN already exists as a Worker secret, it is left unchanged.
  - Otherwise the script uses CLOUDFLARE_API_TOKEN from the environment.
  - If still missing, it prompts securely without echoing the value.

The token should have least-privilege Workers Scripts Read access.
Secret values are never printed.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --worker)
      WORKER="$2"
      shift 2
      ;;
    --repository)
      REPOSITORY="$2"
      shift 2
      ;;
    --account-id)
      ACCOUNT_ID="$2"
      shift 2
      ;;
    --deploy)
      DEPLOY=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "==> Verify Wrangler authentication"
npx wrangler whoami >/dev/null

if [[ -z "$ACCOUNT_ID" ]]; then
  echo "==> Detect Cloudflare account ID"
  WHOAMI_JSON="$(npx wrangler whoami --json)"
  ACCOUNT_ID="$(printf '%s' "$WHOAMI_JSON" | node -e '
    let input="";
    process.stdin.on("data", c => input += c);
    process.stdin.on("end", () => {
      const data = JSON.parse(input);
      const candidates = [];
      if (Array.isArray(data.accounts)) candidates.push(...data.accounts);
      if (data.account) candidates.push(data.account);
      if (data.id) candidates.push(data);
      const ids = [...new Set(candidates.map(x => x && (x.id || x.account_id)).filter(Boolean))];
      if (ids.length === 1) process.stdout.write(ids[0]);
      else process.exit(3);
    });
  ')" || {
    echo "Could not uniquely auto-detect account ID. Re-run with --account-id <ID>." >&2
    exit 1
  }
fi

if [[ ! "$ACCOUNT_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "Invalid Cloudflare account ID." >&2
  exit 1
fi

echo "==> Ensure CLOUDFLARE_API_TOKEN Worker secret exists"
SECRET_LIST="$(npx wrangler secret list --name "$WORKER" 2>/dev/null || true)"
if printf '%s' "$SECRET_LIST" | grep -q 'CLOUDFLARE_API_TOKEN'; then
  echo "CLOUDFLARE_API_TOKEN already exists; leaving it unchanged."
else
  TOKEN="${CLOUDFLARE_API_TOKEN:-}"
  if [[ -z "$TOKEN" ]]; then
    read -rsp "Cloudflare API token (Workers Scripts Read): " TOKEN
    echo
  fi
  if [[ -z "$TOKEN" ]]; then
    echo "Cloudflare API token is required." >&2
    exit 1
  fi
  printf '%s' "$TOKEN" | npx wrangler secret put CLOUDFLARE_API_TOKEN --name "$WORKER"
  unset TOKEN
fi

echo "==> Persist non-secret inventory mapping in wrangler.jsonc"
ACCOUNT_ID="$ACCOUNT_ID" WORKER="$WORKER" REPOSITORY="$REPOSITORY" node <<'NODE'
import fs from "node:fs";

const path = "wrangler.jsonc";
let source = fs.readFileSync(path, "utf8");

function setVar(name, value) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const pattern = new RegExp(`("\\b${name}\\"\\s*:\\s*)\"[^\"]*"`);
  if (pattern.test(source)) {
    source = source.replace(pattern, `$1"${escaped}"`);
    return;
  }

  const varsStart = source.indexOf('"vars"');
  if (varsStart < 0) throw new Error('wrangler.jsonc has no "vars" object');
  const open = source.indexOf("{", varsStart);
  const close = source.indexOf("}", open);
  if (open < 0 || close < 0) throw new Error('cannot locate "vars" object');

  const body = source.slice(open + 1, close);
  const trimmed = body.trimEnd();
  const needsComma = trimmed.trim().length > 0 && !trimmed.trim().endsWith(",");
  const insertion = `${needsComma ? "," : ""}\n    "${name}": "${escaped}"`;
  source = source.slice(0, close) + insertion + source.slice(close);
}

setVar("CLOUDFLARE_ACCOUNT_ID", process.env.ACCOUNT_ID);
setVar("CLOUDFLARE_WORKER_NAME", process.env.WORKER);
setVar("CLOUDFLARE_REPOSITORY", process.env.REPOSITORY);

fs.writeFileSync(path, source);
NODE

echo "==> Verify configuration"
grep -q '"CLOUDFLARE_ACCOUNT_ID"' wrangler.jsonc
grep -q '"CLOUDFLARE_WORKER_NAME"' wrangler.jsonc
grep -q '"CLOUDFLARE_REPOSITORY"' wrangler.jsonc
npx wrangler secret list --name "$WORKER" | grep 'CLOUDFLARE_API_TOKEN' >/dev/null

echo "==> Run checks"
npm run check

if [[ "$DEPLOY" == "true" ]]; then
  echo "==> Deploy"
  npm run deploy
fi

echo
echo "Cloudflare inventory configuration is ready."
echo "Worker: $WORKER"
echo "Repository: $REPOSITORY"
echo "Account ID persisted in wrangler.jsonc."
echo "CLOUDFLARE_API_TOKEN verified without printing its value."
