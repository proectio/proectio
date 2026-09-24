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

Desired app: **ProectioHQ**, owned by the `proectio` organization.

Source of truth: the committed GitHub App manifest
[`config/github-app-manifest.json`](config/github-app-manifest.json).

Public configuration committed in `wrangler.jsonc` (currently stale legacy
state — App ID `5035680` / Client ID `Iv23liRYQ460OIMG6JO8` belong to
**ReporyHQ**, a user-owned app under `sergii`; they are replaced when
ProectioHQ is registered):

- Allowed owner login (`OWNER_LOGIN`, an application allowlist — **not** app ownership): `sergii`

Declared permissions (all read-only, each tied to an endpoint Proectio actually calls):

| Permission   | Level | Required by                                                        |
| ------------ | ----- | ------------------------------------------------------------------ |
| metadata     | read  | installation inventory (`/installation/repositories`)               |
| secrets      | read  | repository and environment secret-name listing (`/actions/secrets`) |
| environments | read  | environment list for environment secret names (`/environments`)     |

No organization permission is requested. Proectio never calls an organization
API endpoint, so none is granted. No webhook events are requested because the
implementation does not receive webhooks. `public` is `false`.

`script/bootstrap_github_app.mjs` verifies that the desired org-owned ProectioHQ
app exists and never creates a duplicate; committed identifiers that resolve to
a different app are treated as stale legacy state.

## Runtime secrets

The following names are declared in `wrangler.jsonc` and must exist as Cloudflare Worker Secrets before deployment:

- `GITHUB_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

GitHub-generated RSA PEM private keys are accepted directly. No local OpenSSL conversion is required.

## Bootstrap

The GitHub App is bootstrapped reproducibly from the committed manifest
[`config/github-app-manifest.json`](config/github-app-manifest.json):

```bash
npm run bootstrap:github-app                 # verify the desired org-owned app; never creates a duplicate
npm run bootstrap:github-app -- --create     # register ProectioHQ from the manifest, replacing stale legacy IDs
```

The default command resolves the desired org-owned ProectioHQ app (by slug, on
GitHub) and verifies it without creating anything. `--create` registers the app
through the GitHub App manifest flow, replaces the stale legacy ReporyHQ
identifiers in config, and stores generated secrets without ever printing them.
See `script/bootstrap_github_app.mjs --help` for options.

The detailed production runbook remains at [docs/bootstrap.md](docs/bootstrap.md).

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
