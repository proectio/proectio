#!/usr/bin/env bash
set -euo pipefail

PROECTIO_WORKER="proectio"
WORKER="proectio"
REPOSITORY="proectio/proectio"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}"
APP_URL=""
DEPLOY=false

usage() {
  cat <<'EOF'
Configure a repository -> Cloudflare Worker mapping for Proectio.

Usage:
  script/configure_cloudflare_inventory.sh [options]

Options:
  --worker NAME          Target Cloudflare Worker name (default: proectio)
  --repository OWNER/REPO
                         Repository mapped to the Worker (default: proectio/proectio)
  --account-id ID        Cloudflare account ID (otherwise auto-detect)
  --app-url URL          Optional deployed application URL
                         Use "$request-origin" for the Proectio app itself
  --proectio-worker NAME Worker that runs Proectio and stores CLOUDFLARE_API_TOKEN
                         (default: proectio)
  --deploy               Deploy Proectio after npm run check
  -h, --help             Show this help

Token behavior:
  - CLOUDFLARE_API_TOKEN belongs to Proectio, not the target Worker.
  - If it already exists on the Proectio Worker, it is left unchanged.
  - Otherwise the script uses CLOUDFLARE_API_TOKEN from the environment.
  - If still missing, it prompts securely without echoing the value.

The token should have least-privilege read access to every mapped Cloudflare resource.
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
    --app-url)
      APP_URL="$2"
      shift 2
      ;;
    --proectio-worker)
      PROECTIO_WORKER="$2"
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

if [[ ! "$REPOSITORY" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]]; then
  echo "Invalid repository. Expected OWNER/REPO." >&2
  exit 1
fi

if [[ -z "$WORKER" || -z "$PROECTIO_WORKER" ]]; then
  echo "Worker names must not be empty." >&2
  exit 1
fi

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

echo "==> Ensure CLOUDFLARE_API_TOKEN exists on Proectio Worker"
SECRET_LIST="$(npx wrangler secret list --name "$PROECTIO_WORKER" 2>/dev/null || true)"
if printf '%s' "$SECRET_LIST" | grep -q 'CLOUDFLARE_API_TOKEN'; then
  echo "CLOUDFLARE_API_TOKEN already exists on $PROECTIO_WORKER; leaving it unchanged."
else
  TOKEN="${CLOUDFLARE_API_TOKEN:-}"
  if [[ -z "$TOKEN" ]]; then
    read -rsp "Cloudflare API token for Proectio (read-only): " TOKEN
    echo
  fi
  if [[ -z "$TOKEN" ]]; then
    echo "Cloudflare API token is required." >&2
    exit 1
  fi
  printf '%s' "$TOKEN" | npx wrangler secret put CLOUDFLARE_API_TOKEN --name "$PROECTIO_WORKER"
  unset TOKEN
fi

echo "==> Upsert repository resource mapping"
ACCOUNT_ID="$ACCOUNT_ID" WORKER="$WORKER" REPOSITORY="$REPOSITORY" APP_URL="$APP_URL" node <<'NODE'
import fs from "node:fs";

const path = "config/repository-resources.json";
const data = JSON.parse(fs.readFileSync(path, "utf8"));
if (!Array.isArray(data.repositories)) throw new Error('"repositories" must be an array');

const repository = process.env.REPOSITORY;
const existing = data.repositories.find((entry) => entry.repository === repository);
const cloudflare = {
  accountId: process.env.ACCOUNT_ID,
  worker: process.env.WORKER,
};

if (process.env.APP_URL) {
  cloudflare.appUrl = process.env.APP_URL;
} else if (existing?.cloudflare?.appUrl) {
  cloudflare.appUrl = existing.cloudflare.appUrl;
}

if (existing) {
  existing.cloudflare = cloudflare;
} else {
  data.repositories.push({ repository, cloudflare });
}

data.repositories.sort((a, b) => a.repository.localeCompare(b.repository));
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
NODE

echo "==> Validate repository resource registry"
npm run validate:resources

echo "==> Verify Proectio Cloudflare token without printing it"
npx wrangler secret list --name "$PROECTIO_WORKER" | grep 'CLOUDFLARE_API_TOKEN' >/dev/null

echo "==> Run checks"
npm run check

if [[ "$DEPLOY" == "true" ]]; then
  echo "==> Deploy Proectio"
  npm run deploy
fi

echo
echo "Cloudflare repository mapping is ready."
echo "Repository: $REPOSITORY"
echo "Cloudflare Worker: $WORKER"
echo "Cloudflare account: $ACCOUNT_ID"
echo "Proectio Worker: $PROECTIO_WORKER"
if [[ -n "$APP_URL" ]]; then
  echo "App URL: $APP_URL"
fi
echo "CLOUDFLARE_API_TOKEN verified on Proectio without printing its value."
