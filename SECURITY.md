# Security Policy

## Supported Versions

Security fixes are provided for the latest released version and the current `main` branch.

This project does not currently maintain separate long-term support branches. If you are self-hosting GitHub Release Monitor, please keep your deployment updated to the latest release.

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Report security vulnerabilities only through GitHub private vulnerability reporting:

- GitHub private vulnerability reporting: https://github.com/iamspido/github-release-monitor/security/advisories/new

Please include as much detail as possible:

- A clear description of the vulnerability
- Steps to reproduce
- Affected version or commit
- Relevant configuration details, without sharing real secrets
- Potential impact
- Suggested mitigation, if known

## Scope

Security-sensitive areas include, but are not limited to:

- Authentication, session handling, passkeys, setup flow, and signup behavior
- Authorization bypasses in `Basic`, `AllowUnauthenticated`, or `External` authentication modes
- Exposure of GitHub, GitLab, Codeberg, SMTP, Apprise, Better Auth, or session secrets
- Import/export handling
- Notification delivery paths
- Server-side request handling for repository providers
- Cross-site scripting, CSRF, SSRF, path traversal, or injection vulnerabilities
- Regular expression handling that can cause denial of service

## Out of Scope

The following are generally out of scope unless they demonstrate a concrete security impact:

- Reports against outdated deployments that are already fixed in the latest release
- Missing security headers without an exploitable impact
- Social engineering or phishing
- Physical attacks
- Denial-of-service reports that only rely on excessive traffic volume
- Vulnerabilities in third-party services or dependencies without a working impact on this project
- Findings caused by intentionally insecure local configuration, such as running production over plain HTTP

## Deployment Security Recommendations

For production deployments:

- Use HTTPS and keep `HTTPS=true` unless the app is strictly local-only.
- Set a strong `BETTER_AUTH_SECRET`.
- Use a strong, one-time `AUTH_SETUP_TOKEN` for initial setup.
- Keep `AUTH_ENABLE_SIGNUP=false` unless public registration is intended.
- Use provider tokens with the minimum required permissions.
- For GitHub public repository monitoring, use a Personal Access Token with no scopes to increase API rate limits without granting unnecessary permissions.
- Restrict GitLab and Codeberg tokens to read-only repository access where possible.
- Protect `.env`, `data/`, database files, backups, and exported configuration files.
- Treat Apprise URLs, SMTP credentials, webhook URLs, and provider tokens as secrets.
- If `AUTHENTICATION_METHOD=External` is used, ensure the reverse proxy or identity provider reliably protects all non-public routes.
- Keep the container image and dependencies updated.

## Disclosure Process

After receiving a GitHub private vulnerability report, maintainers will aim to:

1. Review and acknowledge the report within 14 days.
2. Ask follow-up questions, accept the report as a draft security advisory, or close it with an explanation if it is not considered a security issue.
3. Confirm the impact and affected versions for accepted reports.
4. Prepare and test a fix privately.
5. Publish a patched release and, when appropriate, publish the security advisory.
6. Credit the reporter, unless they prefer to remain anonymous.

This is a hobby project maintained in spare time. Please allow maintainers reasonable time to investigate and release a fix before public disclosure.
