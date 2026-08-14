# Security Policy

## Supported version

Security fixes are applied to the current default branch and the live deployment.

## Report a vulnerability

Do not open a public issue for vulnerabilities involving credentials, private user data,
serverless endpoints, database access, or third-party API abuse.

Use GitHub's private vulnerability reporting feature if it is enabled. Otherwise,
contact the repository owner through the contact method listed on the GitHub profile.

Include the affected route, reproduction steps, impact, and a minimal proof of concept
that does not expose real credentials or personal data.

## Sensitive areas

Take extra care around:

- serverless and proxy endpoints
- Supabase or Neon database credentials
- event-source and media-provider integrations
- cached event data
- outbound links and user-supplied URLs
- environment variables used by deployments

## Secrets

Never commit `.env` files, API keys, service-role keys, database URLs containing
credentials, or deployment tokens. Revoke and rotate any exposed credential.
