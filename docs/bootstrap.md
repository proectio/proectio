# Repory production bootstrap

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
Repory Worker
      |
      +-- Cloudflare Worker Secrets
      +-- GitHub App API
```

GitHub Actions is verification-only. It does not deploy and it does not hold production credentials.

## Values already committed as non-secret configuration

- GitHub App ID: `5035680`
- GitHub Client ID: `Iv23liRYQ460OIMG6JO8`
- Allowed owner login: `sergii`

## Production secrets

Repory requires exactly three runtime secrets:

- `GITHUB_PRIVATE_KEY`
- `GITHUB_CLIENT_SECRET`
- `SESSION_SECRET`

The names are declared in `wrangler.jsonc`; their values exist only in Cloudflare.

## 1. Finish the GitHub App credentials

Open GitHub:

1. Avatar > **Settings**
2. Left sidebar > **Developer settings**
3. **GitHub Apps**
4. Open **ReporyHQ**
5. Stay on **General**

### Client secret

Under **Client secrets**:

1. Select **Generate a new client secret**
2. Copy the generated value
3. Keep it temporarily in a password manager or another secure temporary location
4. Do not put it in Git, GitHub Actions secrets, chat, notes, or source files

### Private key

Still on the ReporyHQ **General** page, scroll to **Private keys**:

1. Select **Generate a private key**
2. GitHub downloads a `.pem` file
3. Keep the file only until the value is stored in Cloudflare
4. No OpenSSL conversion is required; Repory accepts the GitHub-generated RSA PEM directly
5. Do not commit the file

The full file, including the BEGIN/END lines, becomes the value of `GITHUB_PRIVATE_KEY`.

### OAuth callback

Do not use the Webhook URL field.

Leave the final callback URL until the Cloudflare Worker has a real `workers.dev` URL. Repory derives its OAuth callback from the request origin automatically.

## 2. Create the Cloudflare Worker shell

Open the Cloudflare dashboard:

1. **Workers & Pages**
2. **Create application**
3. Choose **Start with Hello World!** / **Create Worker**
4. Name the Worker exactly **repory**
5. Select **Deploy**

The name must be exactly `repory` because Cloudflare requires the dashboard Worker name to match the `name` in `wrangler.jsonc`.

At this point the Hello World code is temporary. Git integration will replace it with Repory.

## 3. Add runtime secrets to Cloudflare

Open:

**Workers & Pages > repory > Settings > Variables and Secrets**

Select **Add** and create three entries with type **Secret**.

### GITHUB_CLIENT_SECRET

- Variable name: `GITHUB_CLIENT_SECRET`
- Type: **Secret**
- Value: the GitHub App client secret generated above

### GITHUB_PRIVATE_KEY

- Variable name: `GITHUB_PRIVATE_KEY`
- Type: **Secret**
- Value: the complete contents of the downloaded GitHub `.pem` file
- Include both the BEGIN and END lines

### SESSION_SECRET

- Variable name: `SESSION_SECRET`
- Type: **Secret**
- Value: a new high-entropy random value

Prefer generating this with a password manager such as 1Password or Apple Passwords. Use at least 32 random bytes / roughly 64 hexadecimal characters. Do not reuse another password or API token.

After all three entries exist, select **Deploy** to apply the secret changes.

Cloudflare hides secret values after they are saved.

## 4. Connect Workers Builds to GitHub

Open:

**Workers & Pages > repory > Settings > Builds**

1. Select **Connect**
2. Choose **GitHub**
3. Authorize the Cloudflare GitHub integration if prompted
4. Select repository **sergii/repory**
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

After Repory has deployed, Cloudflare shows a URL similar to:

```text
https://repory.<your-workers-subdomain>.workers.dev
```

Copy the exact URL.

Return to:

**GitHub > Settings > Developer settings > GitHub Apps > ReporyHQ > General**

Under **Identifying and authorizing users**:

1. Select **Add callback URL**
2. Enter:
   ```text
   https://repory.<your-workers-subdomain>.workers.dev/auth/github/callback
   ```
3. Save changes

The callback belongs in the OAuth callback section, not in **Webhook URL**.

Webhook can remain disabled for VS1.

## 6. Verify

Open:

```text
https://repory.<your-workers-subdomain>.workers.dev/api/health
```

Expected shape:

```json
{
  "ok": true,
  "service": "repory",
  "githubAppConfigured": true
}
```

Then open the Worker root URL and select **Sign in with GitHub**.

Only the GitHub login configured as `OWNER_LOGIN` is allowed into Repory.

After login, verify:

- repositories are listed
- public/private visibility is correct
- archived state is correct
- last push timestamps appear
- opening **Secret names** loads repository secret names
- environment secret names appear without values

## 7. Add organizations later

The same ReporyHQ app can be installed on additional organizations.

For each organization:

1. Open the ReporyHQ GitHub App installation page
2. Select the organization
3. Install the app
4. Prefer **All repositories** for a complete inventory
5. Keep the app permissions read-only

Repory will discover the additional installation without a code change.

## Credential lifecycle

Production source of truth:

- GitHub code: no secret values
- GitHub Actions: no production credentials
- Cloudflare Worker Secrets: runtime credential values
- Password manager: optional break-glass backup

After `GITHUB_PRIVATE_KEY` is safely stored in Cloudflare, either delete the downloaded PEM file or keep one protected recovery copy in a password manager. Never keep an unencrypted copy in the repository or Downloads folder long-term.
