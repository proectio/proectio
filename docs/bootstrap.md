# Proectio production bootstrap

This runbook keeps the local computer out of the production deployment path.

Production flow:

```text
GitHub repository
      |
      | push to main
      v
Cloudflare Workers Builds
      |
      v
Proectio Worker
      |
      +-- Cloudflare Worker Secrets
      +-- GitHub App API
```

GitHub Actions is verification-only. It does not deploy and it does not hold production credentials.

## GitHub App bootstrap flow

```text
repository
   |
   v
authenticated gh
   |
   v
bootstrap GitHub App script
   |
   v
GitHub Manifest registration
   |
   v
manifest code conversion via gh api
   |
   +--> non-secret IDs -> wrangler.jsonc + config/github-app-state.json
   |
   +--> generated secrets -> Cloudflare Worker Secrets
   |
   v
verification
```

The GitHub App configuration is source-controlled in
`config/github-app-manifest.json` and is driven by
`script/bootstrap_github_app.mjs`. Nothing is filled out by hand in the GitHub
Settings form except one confirmation click during a fresh registration.

## Committed non-secret configuration

The committed identifiers are legacy bootstrap state from the Repory era. They
are NOT the production GitHub App and do not prove one exists:

- Legacy GitHub App (verified by API): **ReporyHQ**, user-owned by `sergii`
- Legacy GitHub App ID: `5035680`
- Legacy GitHub Client ID: `Iv23liRYQ460OIMG6JO8`
- Legacy app page: <https://github.com/apps/reporyhq>
- Allowed owner login (`OWNER_LOGIN`, an application allowlist — **not** app ownership): `sergii`
- Desired app to register: **ProectioHQ**, owned by the `proectio` organization
- Declared permissions for the desired app: metadata (read), secrets (read), environments (read)
- Declared events: none

## 1. Prerequisites

- Node.js installed
- `gh` installed and authenticated (`gh auth login`)

```bash
npm install
```

## 2. Create the Cloudflare Worker shell

Open the Cloudflare dashboard:

1. **Workers & Pages**
2. **Create application**
3. Choose **Start with Hello World!** / **Create Worker**
4. Name the Worker exactly **proectio**
5. Select **Deploy**

The name must be exactly `proectio` because Cloudflare requires the dashboard
Worker name to match the `name` in `wrangler.jsonc`.

At this point the Hello World code is temporary. Git integration will replace
it with Proectio.

The Worker must exist before the bootstrap transfers secrets to it.

## 3. Bootstrap the GitHub App

The desired app is the organization-owned `ProectioHQ` registered from
`config/github-app-manifest.json`. It does not exist yet — the committed
identifiers are stale legacy ReporyHQ state. The default command therefore
reports that verification result and never creates anything:

```bash
npm run bootstrap:github-app
```

The script:

- verifies `gh` authentication
- resolves the repository owner (the `proectio` organization)
- checks GitHub for the desired org-owned app by its slug
- reports the committed App ID / Client ID as stale legacy ReporyHQ identifiers
- refuses to treat committed IDs as proof that the desired app exists

### Registering ProectioHQ

```bash
npm run bootstrap:github-app -- --create --org proectio --sync-cloudflare
```

The `url` field in the manifest must point at a sensible project URL; it
already does.

Flow:

1. The script validates prerequisites and reads the manifest
2. It verifies no desired org-owned ProectioHQ app exists yet, and detects the
   committed identifiers as stale legacy state (it prints what will be replaced
   and asks you to type `replace`; `--force` skips that confirmation)
3. It determines ownership as the `proectio` organization
4. It starts a localhost callback server and opens
   `http://127.0.0.1:4567/start` in the default browser
5. The page POSTs the manifest to
   `https://github.com/organizations/proectio/settings/apps/new`
6. **Single manual boundary:** you click the GitHub confirmation to create the
   app. GitHub then redirects to the localhost callback
7. The script converts the temporary code with
   `gh api POST /app-manifests/{code}/conversions`
8. Non-secret identifiers for the NEW app atomically replace the stale values
   in `wrangler.jsonc` and `config/github-app-state.json`
9. Generated secrets
   (`GITHUB_PRIVATE_KEY`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`) go straight
   into Cloudflare Worker Secrets; they are never printed

If you want local development secrets instead of Cloudflare transfer, omit
`--sync-cloudflare`; the script writes `.dev.vars` (mode `0600`, gitignored)
for local development only.

### Duplicate protection

- `--create` refuses only when a VERIFIED desired org-owned ProectioHQ app
  already exists (resolved from GitHub by slug and matching the committed
  client ID)
- Committed App ID / Client ID that resolve to a different owner/app are stale
  legacy state: they do not block registration and get replaced
- The tool never silently creates `ProectioHQ-2` style duplicates

`npm run bootstrap:github-app -- --help` documents all options.

### Removing the legacy ReporyHQ app

After ProectioHQ is registered, remove the legacy user-owned ReporyHQ app in a
separate manual step (the bootstrap must not delete it):

1. Open <https://github.com/settings/apps> (user-level Developer settings)
2. Select **ReporyHQ** (App ID `5035680`, client ID `Iv23liRYQ460OIMG6JO8`)
3. Confirm deletion

Deleting an app also removes its installations; uninstall it from any
repositories first if the inventory would be affected.

## 4. Connect Workers Builds to GitHub

Open:

**Workers & Pages > proectio > Settings > Builds**

1. Select **Connect**
2. Choose **GitHub**
3. Authorize the Cloudflare GitHub integration if prompted
4. Select repository **proectio/proectio**
5. Configure:
   - Production branch: `main`
   - Root directory: repository root
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Preview deploy command: leave the Cloudflare default `npx wrangler versions upload` if that field is shown
6. Save the build configuration

From this point, production deployment is remote:

```text
merge/push main -> Workers Builds -> wrangler deploy -> production
```

No Cloudflare API token is required in the GitHub repository for this flow.

## 5. Configure the final GitHub OAuth callback

After Proectio has deployed, Cloudflare shows a URL similar to:

```text
https://proectio.<your-workers-subdomain>.workers.dev
```

Copy the exact URL.

Return to:

**GitHub > Settings > Developer settings > GitHub Apps > ProectioHQ > General**

Under **Identifying and authorizing users**:

1. Select **Add callback URL**
2. Enter:
   ```text
   https://proectio.<your-workers-subdomain>.workers.dev/auth/github/callback
   ```
3. Save changes

The callback belongs in the OAuth callback section, not in **Webhook URL**.

Webhook can remain disabled for VS1; Proectio receives no webhook events.

## 6. Install the app

Install ProectioHQ on the account whose repositories should be inventoried:

1. Open the ProectioHQ GitHub App installation page
2. Select the account
3. Install the app
4. Prefer **All repositories** for a complete inventory
5. Keep the app permissions read-only

Proectio discovers installations automatically.

## 7. Verify

Open:

```text
https://proectio.<your-workers-subdomain>.workers.dev/api/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "proectio",
  "githubAppConfigured": true
}
```

Then open the Worker root URL and select **Sign in with GitHub**.

Only the GitHub login configured as `OWNER_LOGIN` is allowed into Proectio.

After login, verify:

- repositories are listed
- public/private visibility is correct
- archived state is correct
- last push timestamps appear
- opening **Secret names** loads repository secret names
- environment secret names appear without values

Run the bootstrap once more to confirm the happy path:

```bash
npm run bootstrap:github-app
```

It must resolve the verified org-owned ProectioHQ app, report it as existing,
and create nothing.

## Add organizations later

The same ProectioHQ app can be installed on additional organizations.

For each organization:

1. Open the ProectioHQ GitHub App installation page
2. Select the organization
3. Install the app
4. Prefer **All repositories** for a complete inventory
5. Keep the app permissions read-only

Proectio will discover the additional installation without a code change.

## Credential lifecycle and rotation

Production source of truth:

- GitHub code: no secret values
- GitHub Actions: no production credentials
- Cloudflare Worker Secrets: runtime credential values
- Password manager: optional break-glass backup

Runtime secret names (declared in `wrangler.jsonc`):

- `GITHUB_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

GitHub-generated RSA PEM private keys are accepted directly. No local OpenSSL
conversion is required.

First-time registration generates all three secrets automatically
(`SESSION_SECRET` is generated with cryptographically secure randomness and is
never derived from GitHub credentials).

Credential rotation stays separate from first-time bootstrap. To rotate, use
the GitHub App settings to generate a new client secret or private key, then
push the new values to Cloudflare with the existing helper:

```bash
script/bootstrap_production.sh
```

or replace the values directly in Cloudflare:

**Workers & Pages > proectio > Settings > Variables and Secrets**

Never commit credential values. Keep at most one encrypted recovery copy of the
private key in a password manager, and delete downloaded PEM files after the
values are stored.