# Repory

Personal GitHub repository inventory and configuration dashboard.

Repory gives one read-only view of GitHub accounts, organizations, repositories, visibility, recent activity, environments, and secret names. It never reads or stores secret values.

## VS1

The first vertical slice uses:

- React + TypeScript for the dashboard.
- Cloudflare Worker for GitHub OAuth and GitHub App API access.
- Cloudflare Workers static assets for the frontend.
- No database.

The Worker authenticates the owner with GitHub OAuth, then uses the ReporyHQ GitHub App installation to enumerate repositories. Secret metadata is loaded lazily per repository so a large GitHub account does not turn one dashboard request into hundreds of API subrequests.

## Required GitHub App permissions

Repository permissions:

- Metadata: Read-only
- Secrets: Read-only
- Environments: Read-only

Organization permissions:

- Secrets: Read-only

Everything else stays at No access for VS1.

## Local configuration

Copy `.dev.vars.example` to `.dev.vars` and populate it locally. Never commit `.dev.vars` or the GitHub App private key.

Required values:

- `GITHUB_APP_ID`
- `GITHUB_PRIVATE_KEY` as PKCS#8 PEM
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`
- `SESSION_SECRET`
- `OWNER_LOGIN`

A GitHub-generated PKCS#1 private key can be converted once with:

```bash
openssl pkcs8 -topk8 -nocrypt -in reporyhq.pem -out reporyhq-pkcs8.pem
```

## Commands

```bash
npm install
npm run check
npm run dev
npm run dev:worker
```

`npm run dev` runs only the Vite frontend. `npm run dev:worker` builds the frontend and starts the Cloudflare Worker so OAuth and `/api/inventory` are available.

## Security principles

- Never read or store secret values.
- GitHub App permissions stay read-only.
- Inventory APIs require an authenticated owner session.
- GitHub App credentials stay in Cloudflare secrets or local `.dev.vars` only.
- No repository contents permission is requested.
