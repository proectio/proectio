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

## VS2: cross-provider secret-name inventory

Proectio can compare secret names between a GitHub repository and its mapped Cloudflare Worker without reading secret values.

Repository-to-infrastructure mappings live in the committed resource registry
`config/repository-resources.json`.

The first mapping is:

- GitHub repository: `proectio/proectio`
- Cloudflare account: `3094c995ea8e0405b8aa7fd1259eaea8`
- Cloudflare Worker: `proectio`

The comparison classifies each name as:

- `both`
- `github-only`
- `cloudflare-only`

Cloudflare access is optional. If it is not configured, GitHub inventory continues to work and the UI reports that Cloudflare inventory is not configured.

Required Cloudflare runtime configuration:

- `config/repository-resources.json` — non-secret per-repository resource mappings
- `CLOUDFLARE_API_TOKEN` — Proectio Worker secret with read access to mapped Cloudflare resources

The Cloudflare API call is read-only and returns secret names/types, not values.

Repeatable bootstrap:

```bash
npm run configure:cloudflare-inventory
```

The bootstrap verifies Wrangler authentication, auto-detects the account ID when possible,
preserves an existing `CLOUDFLARE_API_TOKEN` on the Proectio Worker, securely prompts only when
the secret is absent, upserts the non-secret repository mapping in
`config/repository-resources.json`, validates the registry, runs `npm run check`, and deploys
only when explicitly invoked with:

```bash
npm run configure:cloudflare-inventory -- --deploy
```

For automation, `--account-id`, `--worker`, `--repository`, `--app-url`, and
`--proectio-worker` are supported. The target Worker and the Proectio Worker are intentionally
separate concepts: the API token is stored on Proectio, not copied into every inspected Worker.

## VS3: expected-state secret placement policy

Proectio can compare observed secret-name placement with a committed expected-state policy in
`config/secret-placement-policy.json`.

Each secret receives a placement verdict:

- `expected` — actual providers exactly match policy
- `missing` — one or more expected providers do not contain the secret name
- `unexpected` — the secret exists in an extra provider beyond policy
- `misplaced` — an expected provider is missing while an unexpected provider contains it
- `unmanaged` — an observed secret name has no policy entry

Policy-only names are included in the comparison, so Proectio can report a missing secret even
when it exists in neither provider. Policy contains names and provider placement only; no secret
values are committed, read, or stored.

The initial Proectio policy expects its four Worker runtime credentials only in Cloudflare:
`CLOUDFLARE_API_TOKEN`, `GITHUB_CLIENT_SECRET`, `GITHUB_PRIVATE_KEY`, and `SESSION_SECRET`.


## GitHub App

Desired app: **Proectio Repo Observer**, owned by the `proectio` organization.

Source of truth: the committed GitHub App manifest
[`config/github-app-manifest.json`](config/github-app-manifest.json).

Current public configuration committed in `wrangler.jsonc`:

- GitHub App ID: `5062093`
- GitHub Client ID: `Iv23lignlZc2qFlBadPp`
- Allowed dashboard login (`OWNER_LOGIN`, an application allowlist - **not** app ownership): `sergii`

`config/github-app-state.json` records that these identifiers belong to
**Proectio Repo Observer**, owned by the `proectio` organization.

Declared permissions (all read-only, each tied to an endpoint Proectio actually calls):

| Permission   | Level | Required by                                                        |
| ------------ | ----- | ------------------------------------------------------------------ |
| metadata       | read  | installation inventory (`/installation/repositories`)                    |
| secrets        | read  | repository and environment secret-name listing (`/actions/secrets`)      |
| environments   | read  | environment list for environment secret names (`/environments`)          |
| actions        | read  | workflow inventory (`/actions/workflows`)                                |
| administration | read  | default-branch protection (`/branches/{branch}/protection`)               |

No organization permission is requested. Proectio never calls an organization
API endpoint, so none is granted. No webhook events are requested because the
implementation does not receive webhooks.

The manifest declares `public: true`. In GitHub App terminology this means the app
can be installed on accounts other than its owner; it does **not** mean Marketplace
publication. For the already-created app, the equivalent **Any account** setting must
be enabled once in GitHub's App settings.

`script/bootstrap_github_app.mjs` verifies that the desired org-owned Proectio Repo Observer
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
npm run bootstrap:github-app -- --create     # register Proectio Repo Observer from the manifest, replacing stale legacy IDs
```

The default command resolves the desired org-owned Proectio Repo Observer app (by slug, on
GitHub) and verifies it without creating anything. It also requires the committed manifest
to declare `public: true`. `--create` is reserved for recreating the app from the manifest
and stores generated secrets without ever printing them.
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
- No repository contents permission is requested by Proectio Repo Observer.


## Repository governance

Proectio also inspects two read-only GitHub governance surfaces:

- GitHub Actions workflows configured for the repository
- protection settings for the repository's default branch

These checks require the GitHub App permissions `actions: read` and `administration: read`.
If an existing Proectio installation has not yet accepted the new permissions, the dashboard keeps the rest of the repository inventory available and shows the governance card as permission unavailable instead of failing the whole repository inspection.


## VS4: repository governance policy

Proectio compares observed default-branch protection with a committed expected-state policy in
`config/governance-policy.json`.

The initial policy for `proectio/proectio` expects the default branch to:

- be protected
- require pull request reviews
- require at least one approving review
- require the `check` status check
- apply branch protection to administrators

The dashboard reports deterministic governance findings whenever observed GitHub settings drift
from that policy. Policy evaluation is read-only: Proectio does not modify repository settings.


## VS5: repository resource registry

Proectio is no longer coupled to one Cloudflare Worker through singleton Wrangler variables.

`config/repository-resources.json` is the source of truth for repository-to-resource mappings.
Each repository may define an optional Cloudflare integration with:

- `accountId`
- `worker`
- optional `appUrl`
- `$request-origin` as the explicit app URL sentinel for Proectio itself

Repositories without a Cloudflare mapping remain valid GitHub-only repositories. Secret inventory
and Cloudflare runtime inspection resolve resources from the registry per repository.

The registry is validated on every `npm run check`. Validation rejects malformed repository
names, missing Cloudflare fields, duplicate repository entries, duplicate account/Worker mappings,
and invalid app URLs.

Add or update a mapping with:

```bash
npm run configure:cloudflare-inventory -- \
  --repository owner/repository \
  --worker worker-name \
  --account-id account-id \
  --app-url https://example.com
```


## GitHub App repository access

The dashboard shows exactly the repositories visible to each Proectio Repo Observer installation.

For each installation Proectio surfaces GitHub's repository selection mode:

- `all` - the App can access all repositories in that account
- `selected` - the App can access only repositories selected in GitHub installation settings

The dashboard includes direct actions to manage repository selection for an existing installation and
to open the GitHub App installation flow for another account or organization. Proectio does not
pretend that unselected repositories are visible: GitHub does not expose repository data to the
installation until access is granted.


### Install on additional accounts

Because Proectio is intended to inventory repositories across accounts, the GitHub App must use
**Any account** installation scope. After the one-time GitHub App setting is enabled:

1. use **Add account / repositories** in Proectio
2. select the target account, such as `sergii`
3. choose **All repositories** or **Only select repositories**
4. confirm the installation

The existing app does not need to be recreated merely to change this setting.
