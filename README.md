# Repory

Personal GitHub repository inventory and configuration dashboard.

Repory is a read-only control panel for GitHub repositories and organizations. It is designed to show repository metadata, activity, environments, and secret names without ever reading secret values.

## Security principles

- Never read or store secret values.
- Use a GitHub App with read-only permissions.
- Keep application credentials out of the repository.
- Prefer least-privilege access.
