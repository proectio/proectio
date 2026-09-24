# Proectio

Personal GitHub repository inventory and configuration dashboard.

Proectio gives one read-only view of GitHub accounts, organizations, repositories, visibility, recent activity, environments, and secret names. It never reads or stores secret values.

## Architecture

```text
GitHub
  |
  | CI: typecheck / tests / build
  |
  +----------------------------+
                               |
                               v
                    Cloudflare Workers Builds
                               |
                               | deploy from main
                               v
                         Proectio Worker
                               |
                               +-- GitHub App API
                               +-- Worker Secrets
```

The normal production path is remote-first:

- GitHub Actions verifies code only.
- Cloudflare Workers Builds owns deployment.
- Production credentials live in Cloudflare Worker Secrets.
- A local computer is not required to deploy production.

## VS1

- React + TypeScript dashboard
- Cloudflare Worker backend
- GitHub OAuth restricted to the configured owner login
- GitHub App installation authentication
- repository inventory across app installations
- public/private/archived status and last-push activity
- lazy loading of repository and environment secret names
- no secret values
- no database

## GitHub App

App: **ProectioHQ**

Public configuration committed in `wrangler.jsonc`:

- App ID: `5035680`
- Client ID: `Iv23liRYQ460OIMG6JO8`
- Owner login: `sergii`

Required repository permissions:

- Metadata: Read-only
- Secrets: Read-only
- Environments: Read-only

Required organization permissions:

- Secrets: Read-only

Everything else remains No access for VS1.

## Runtime secrets

The following names are declared in `wrangler.jsonc` and must exist as Cloudflare Worker Secrets before deployment:

- `GITHUB_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

GitHub-generated RSA PEM private keys are accepted directly. No local OpenSSL conversion is required.

## Bootstrap

Follow the detailed UI runbook:

[docs/bootstrap.md](docs/bootstrap.md)

## Commands

Local development is optional.

```bash
npm install
npm run check
npm run dev
npm run dev:worker
```

Production deployment should normally happen through Cloudflare Workers Builds rather than a local `wrangler deploy`.

## Security principles

- Never read or store GitHub secret values.
- Never commit runtime credentials.
- Keep GitHub App permissions read-only.
- Restrict the dashboard to the configured owner login.
- Keep GitHub Actions verification-only.
- Keep production credential values in Cloudflare.
- No repository contents permission is requested by ProectioHQ.
