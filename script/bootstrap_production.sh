#!/usr/bin/env bash
set -euo pipefail

WORKER="${WORKER:-proectio}"

echo "==> GitHub authentication"
gh auth status

echo
echo "==> Cloudflare authentication"
npx wrangler whoami

echo
read -rsp "GitHub App Client Secret: " GITHUB_CLIENT_SECRET
echo

read -rp "GitHub App private key (.pem) path: " GITHUB_PRIVATE_KEY_PATH

if [[ ! -f "$GITHUB_PRIVATE_KEY_PATH" ]]; then
  echo "Private key not found: $GITHUB_PRIVATE_KEY_PATH" >&2
  exit 1
fi

echo
read -rsp "Session Secret [ENTER = generate automatically]: " SESSION_SECRET
echo

if [[ -z "$SESSION_SECRET" ]]; then
  SESSION_SECRET="$(openssl rand -base64 48)"
fi

echo
echo "==> Uploading runtime secrets to Cloudflare Worker: $WORKER"

printf '%s' "$GITHUB_CLIENT_SECRET" \
  | npx wrangler secret put GITHUB_CLIENT_SECRET --name "$WORKER"

cat "$GITHUB_PRIVATE_KEY_PATH" \
  | npx wrangler secret put GITHUB_PRIVATE_KEY --name "$WORKER"

printf '%s' "$SESSION_SECRET" \
  | npx wrangler secret put SESSION_SECRET --name "$WORKER"

unset GITHUB_CLIENT_SECRET
unset SESSION_SECRET

echo
echo "==> Current Worker secrets"
npx wrangler secret list --name "$WORKER"

echo
echo "Bootstrap complete."
