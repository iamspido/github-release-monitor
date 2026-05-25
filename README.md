# GitHub Release Monitor

A powerful, self-hostable application to automatically monitor GitHub, GitLab, and Codeberg repository releases and receive instant email or Apprise notifications. Keep track of your favorite projects without manually checking for updates.

## ✨ Key Features

- **Automated Release Monitoring**: Add public GitHub, GitLab, and Codeberg repositories and let the app automatically check for new releases in the background.
- **Flexible Notifications**:
  - **Email**: Configure SMTP settings to receive detailed email notifications.
  - **Apprise**: Integrate with [Apprise](https://github.com/caronc/apprise) to send notifications to over 70 services like Discord, Telegram, Slack, and more.
- **Flexible Release Filtering**:
    - **Global Settings**: Define application-wide rules for which release types (stable, pre-release, draft) to monitor.
    - **Per-Repository Overrides**: Customize filtering rules for individual repositories.
    - **Regex-Powered Precision**: Use "Include" and "Exclude" regular expression patterns for fine-grained control over release tags. The "Include" pattern overrides the standard channel filters, giving you ultimate control.
    - **Pre-release Granularity**: Select specific pre-release tags to watch (e.g., `alpha`, `beta`, `rc`).
- **Modern & Responsive UI**:
    - Clean, intuitive interface built with ShadCN UI and Tailwind CSS.
    - Full dark mode support.
    - Responsive design for both desktop and mobile use.
- **Internationalization (i18n)**: Supports English and German out of the box.
- **Data Management**: Easily import or export your list of monitored repositories via JSON.
- **System Diagnostics**: A built-in test page to verify GitHub API connectivity and notification service (SMTP, Apprise) configuration.
- **Secure Authentication**: Protects the application with Better Auth, SQLite-backed users/sessions, and one-time bootstrap setup.

<table>
  <tr>
    <td><img width="1872" height="1277" alt="Image" src="https://github.com/user-attachments/assets/febdf1de-db54-46ba-8614-c0fde118d8f9" /></td>
    <td><img width="1734" height="1275" alt="Image" src="https://github.com/user-attachments/assets/41c5f4df-205e-4572-90d8-e30133f15764" /></td>
  </tr>
  <tr>
    <td><img width="1542" height="1068" alt="Image" src="https://github.com/user-attachments/assets/1848e60d-ecc1-46bb-a9f3-371983c71153" /></td>
    <td><img width="1738" height="1275" alt="Image" src="https://github.com/user-attachments/assets/142f354d-99da-4e95-bb3c-ab016a60d2cb" /></td>

  </tr>
</table>

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **UI**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [ShadCN UI](https://ui.shadcn.com/)
- **Internationalization**: [next-intl](https://next-intl.dev/)
- **Authentication**: [Better Auth](https://www.better-auth.com)
- **Notifications**: [Nodemailer](https://nodemailer.com/), [Apprise](https://github.com/caronc/apprise)

## ❤️ Sponsors

Thanks to the people and organizations supporting this project.

<p>
  <a href="https://horizify.de/">
    <img width="180" alt="Horizify GmbH logo" src="https://github.com/user-attachments/assets/4646f922-c689-494e-bc1a-db51fca77df2" />
  </a>
</p>

**[Horizify GmbH](https://horizify.de/)** supports the ongoing development of this project.

**One-time donation:**

- [chip-well](https://github.com/chip-well)

## 📜 License

This project is licensed under the **AGPL-3.0-only License**.

---

## 🐳 Docker Compose Setup (Recommended)

The `example/` directory contains a complete Docker Compose setup for a robust, production-ready deployment. This setup includes:
- **Traefik**: A modern reverse proxy that automatically handles SSL certificates from Let's Encrypt.
- **SMTP-Relay**: A local SMTP server for sending email notifications.
- **GitHub Release Monitor**: The main application itself.

### 1. Prerequisites
- Docker and Docker Compose installed on your server.
- A domain name (e.g., `github-releases.your-domain.com`) pointing to your server's public IP address.

### 2. Configuration
Navigate to the `example/` directory. You will need to configure the environment files for each service.

#### a) GitHub Release Monitor (Main App)
1. Go to `example/github-release-monitor`.
2. Edit the existing `.env` file. Below are the key variables to configure.

   **Authentication (Required)**
   ```env
   # Basic: internal login required for the app.
   # AllowUnauthenticated: public read-only home; login required for changes, settings, and test page.
   # External: disables internal auth gates for deployments protected by Authelia, Authentik, TinyAuth, NGINX Basic auth, etc.
   AUTHENTICATION_METHOD=Basic

   # Optional login rate-limit/lockout protection (values in seconds)
   # Lockout duration once the threshold is reached.
   AUTH_LOGIN_LOCKOUT_SECONDS=900
   # Time window to count failed attempts.
   AUTH_LOGIN_WINDOW_SECONDS=900
   # Maximum failed login attempts before lockout starts.
   AUTH_MAX_LOGIN_ATTEMPTS=5

   # Better Auth secret (at least 32 chars). Generate: openssl rand -base64 32
   BETTER_AUTH_SECRET=your_super_secret_better_auth_key_here
   # Base URL of the app (required by Better Auth for cookie/session handling)
   BETTER_AUTH_URL=https://github-releases.your-domain.com
   # One-time token for initial admin setup (recommended 32+ chars)
   AUTH_SETUP_TOKEN=your_one_time_setup_token_here
   # Keep self-service signup disabled by default (recommended for single-user)
   AUTH_ENABLE_SIGNUP=false
   # Enable passkeys (WebAuthn) for passwordless login
   AUTH_ENABLE_PASSKEY=true
   # Optional social login providers
   AUTH_GITHUB_CLIENT_ID=
   AUTH_GITHUB_CLIENT_SECRET=
   AUTH_GOOGLE_CLIENT_ID=
   AUTH_GOOGLE_CLIENT_SECRET=
   # Trust configured social providers for automatic account linking by email
   AUTH_TRUST_SOCIAL_LINKING=true
   # Optional fallback for older setups:
   # You can generate one using: openssl rand -base64 32
   AUTH_SECRET=your_super_secret_better_auth_key_here
   ```

   **Protocol (HTTP/HTTPS)**
   By default, the application runs in secure (HTTPS) mode. If you are not using a reverse proxy and need to run the app on plain HTTP, you must set this variable.
   ```env
   # Set to 'false' only if running without SSL/TLS (e.g., direct HTTP access).
   # This makes session cookies insecure. Recommended to leave as 'true' for production.
   HTTPS=true
   ```

   **GitHub API (Recommended)**
   To avoid being rate-limited, it is highly recommended to create a [Personal Access Token](https://github.com/settings/personal-access-tokens) with **no scopes** (public repository access is sufficient and more secure).
   ```env
   # Your GitHub Personal Access Token to increase the API rate limit from 60 to 5000 requests/hour.
   # Create a token with no scopes (public repo access) for better security.
   GITHUB_ACCESS_TOKEN=your_github_pat_here
   ```

   **GitLab API (Optional)**
   If you want to monitor private GitLab repositories (including self-hosted instances), configure allowed hosts and host-based tokens:
   - Access token option: `GITLAB_ACCESS_TOKENS` with scopes `read_api` and `read_repository`.
   - Deploy token option: `GITLAB_DEPLOY_TOKENS` with scope `read_repository`.
   - For private repositories, ensure the token has at least project role `Reporter` (or higher).
   ```env
   # Optional additional GitLab instances besides gitlab.com (comma-separated).
   GITLAB_ADDITIONAL_HOSTS=gitlab.example.com,gitlab.internal.example

   # Optional host-based GitLab tokens as comma-separated host=token pairs.
   # Example: gitlab.com=glpat_xxx,gitlab.example.com=glpat_yyy
   GITLAB_ACCESS_TOKENS=

   # Optional host-based GitLab deploy tokens as comma-separated host=username:token pairs.
   # Example: gitlab.example.com=gitlab+deploy-token-123:gl-dpt-xyz
   GITLAB_DEPLOY_TOKENS=
   ```

   **Codeberg API (Optional)**
   Codeberg runs on Gitea/Forgejo and exposes a Gitea-compatible REST API. If you want to monitor private repos, set a token:
   - For private repositories, the token typically needs `read:repository`.
   - `read:user` is only needed for diagnostics (e.g. showing the authenticated username on the test page).
   - API limit: 2000 requests per 5 minutes (applies with or without a token).
   ```env
   CODEBERG_ACCESS_TOKEN=your_codeberg_token_here
   ```

   **Localization**
   Set the timezone for date and log formatting.
   ```env
   # The timezone for the container (e.g., `Europe/Berlin`).
   TZ=Europe/Berlin
   ```

   **Logging**
   Control the verbosity of server-side logs. Timestamps always use the server timezone (`TZ`).
   ```env
   # One of: error, warn, info, debug, silent
   # Defaults: development=debug, production=warn (if unset)
   # Failed logins and active lockouts are logged at WARN.
   # Successful logins and lockout expiry (access unblocked) are logged at INFO.
   LOG_LEVEL=info
   ```

   **Email (SMTP) Configuration**
   The example compose setup uses a local SMTP relay. The default values are already set for this. You only need to change `MAIL_FROM_ADDRESS` and `MAIL_TO_ADDRESS`.
   ```env
   # The "from" and "to" addresses for notifications.
   MAIL_FROM_ADDRESS=notifications@your-domain.com
   MAIL_FROM_NAME=GitHub Release Monitor
   MAIL_TO_ADDRESS=your-personal-email@example.com
   ```
   **Important**: For this Docker setup, `MAIL_HOST` is correctly set to `smtp` and `MAIL_PORT` to `25`. You do not need a `MAIL_USERNAME` or `MAIL_PASSWORD` for the local relay.

   **Apprise Configuration (Optional)**
   Connect to an Apprise service for multi-platform notifications.
   ```env
   # This URL points to your Apprise service's notification endpoint.
   #
   # Case 1: For stateless notifications via `APPRISE_STATELESS_URLS` in Apprise,
   # use the general notify endpoint.
   # APPRISE_URL=http://apprise:8000/notify
   #
   # Case 2: For notifications configured via the Apprise web UI, include the
   # specific configuration key in the path.
   # APPRISE_URL=http://apprise:8000/notify/your_key
   #
   # IMPORTANT: The configuration of the actual notification services (e.g., Telegram bots,
   # Discord webhooks) is done within the Apprise application itself, either via environment
   # variables or its web UI.
   APPRISE_URL=
   ```

3. Edit `compose.yaml`.
4. Update the Traefik router rule to use your domain name:
   ```yaml
   # ...
   labels:
     # ...
     # HTTP Router
     - "traefik.http.routers.github-release-monitor.rule=Host(`github-releases.your-domain.com`)"
     # HTTPS Router
     - "traefik.http.routers.github-release-monitor-secured.rule=Host(`github-releases.your-domain.com`)"
     # ...
   ```

#### b) Traefik (Reverse Proxy)
1. Go to `example/traefik`.
2. Edit `compose.yaml`.
3. Change the email address for Let's Encrypt certificate registration:
   ```yaml
   # ...
   command:
     # ...
     - "--certificatesresolvers.letsencrypt.acme.email=your-email@your-domain.com"
     # ...
   ```

#### c) SMTP Relay (Optional, for Email Functionality)
For improved email deliverability and to avoid being marked as spam, it's recommended to configure the SMTP relay with your domain.
1. Go to `example/smtp`.
2. Edit `compose.yaml`.
3. Update `POSTFIX_myhostname` and `OPENDKIM_DOMAINS` to match the domain from which you are sending emails. This should typically be the domain you are using for the `MAIL_FROM_ADDRESS` in the main app's `.env` file.
   ```yaml
   # ...
   environment:
     - "POSTFIX_myhostname=your-domain.com"
     - "OPENDKIM_DOMAINS=your-domain.com=example-mail"
   # ...
   ```
For further customization of the SMTP relay, please refer to the official documentation of the [wader/postfix-relay](https://github.com/wader/postfix-relay) image.

### 3. Prepare Data Directory
The application stores its configuration and data in a `./data` directory. For Docker, this directory on your host machine must have the correct permissions so that the application process inside the container can write to it.
This is required for both repository/settings data and Better Auth state: the container writes `/app/data/auth.db` for users/sessions and `/app/data/auth-setup.lock` after the initial account has been created. If `/app/data` is not mounted or is not writable by UID/GID `1001`, the container can fail during startup.

Create the directory and set the appropriate ownership before starting the containers:
```bash
# Navigate to the correct folder
cd example/github-release-monitor

# Create the data directory
mkdir -p data

# Set ownership to user/group 1001 (the standard non-root user in many Node.js images)
sudo chown -R 1001:1001 data
```

### 4. Launch the Stack
Start each service using Docker Compose. It's recommended to start them in the following order from the root of the project:

```bash
# 1. Start Traefik (creates the shared network)
docker compose -f example/traefik/compose.yaml up -d

# 2. Start the SMTP Relay
docker compose -f example/smtp/compose.yaml up -d

# 3. Start the GitHub Release Monitor
docker compose -f example/github-release-monitor/compose.yaml up -d
```

After a few moments, your application should be accessible at `https://github-releases.your-domain.com` with a valid SSL certificate.

---

## 🐳 Docker Run Setup

If you prefer not to use Docker Compose, you can run the application using a single Docker command.

### 1. Configure Environment
Before running the container, you must create a `.env` file in the same directory where you will run the `docker run` command. The container will read its configuration from this file.

Copy the required variables from the manual setup guide's [environment configuration section](#4-configure-environment-variables) into a new file named `.env`. For a direct HTTP setup without a proxy, you must add `HTTPS=false`.

```env
# ... other variables
HTTPS=false
```

### 2. Prepare Data Directory and Run Container
Create a host directory for the application data and set the correct permissions.
The bind mount is required because Better Auth stores its SQLite database at `/app/data/auth.db`. The mounted directory must be writable by UID/GID `1001`, which is the non-root user used by the production container.
```bash
# Create the data directory
mkdir -p data

# Set ownership to user/group 1001 (common for non-root Node.js containers)
sudo chown -R 1001:1001 data

# Pull the latest image and run the container
docker run -d \
  -p 8080:3000 \
  -v ./data:/app/data \
  --env-file ./.env \
  --name github-release-monitor \
  ghcr.io/iamspido/github-release-monitor:latest
```
The application will be accessible on `http://localhost:8080`. Note that this setup does not include a reverse proxy or automatic SSL, which is recommended for production use.

---

## 🛠️ Setup Guide (Manual)

Follow these steps for a manual setup of the GitHub Release Monitor.

### 1. Clone the Repository

First, clone the project to your local machine:

```bash
git clone https://github.com/iamspido/github-release-monitor.git
cd github-release-monitor
```

### 2. Install Dependencies

Install the required npm packages.
```bash
npm install
```

### 3. Create Data Directory and Set Permissions
The application saves its configuration in a `data/` directory at the project root. Ensure this directory exists and is writable by the user that will run the Next.js process.

```bash
# Create the directory
mkdir -p data

# Ensure the user running the app can write to it (example)
# This might not be necessary if you are the owner.
sudo chown $(whoami) data
```


### 4. Configure Environment Variables

The application is configured using a `.env` file in the root of the project. Create this file by copying the example:

```bash
# In your terminal
touch .env
```

Now, open the `.env` file and add the following variables.

#### **Authentication (Required)**

These variables are essential for securing your application.

```env
# Basic: internal login required for the app.
# AllowUnauthenticated: public read-only home; login required for changes, settings, and test page.
# External: disables internal auth gates for deployments protected by Authelia, Authentik, TinyAuth, NGINX Basic auth, etc.
AUTHENTICATION_METHOD=Basic

# Optional login rate-limit/lockout protection (values in seconds)
# Lockout duration once the threshold is reached.
AUTH_LOGIN_LOCKOUT_SECONDS=900
# Time window to count failed attempts.
AUTH_LOGIN_WINDOW_SECONDS=900
# Maximum failed login attempts before lockout starts.
AUTH_MAX_LOGIN_ATTEMPTS=5

# Better Auth secret (at least 32 chars). Generate: openssl rand -base64 32
BETTER_AUTH_SECRET=your_super_secret_better_auth_key_here
# Base URL of the app
BETTER_AUTH_URL=http://localhost:3000
# One-time token for initial admin setup (recommended 32+ chars)
AUTH_SETUP_TOKEN=your_one_time_setup_token_here
# Keep self-service signup disabled by default
AUTH_ENABLE_SIGNUP=false
# Enable passkeys (WebAuthn) for passwordless login
AUTH_ENABLE_PASSKEY=true
# Optional social login providers
AUTH_GITHUB_CLIENT_ID=
AUTH_GITHUB_CLIENT_SECRET=
AUTH_GOOGLE_CLIENT_ID=
AUTH_GOOGLE_CLIENT_SECRET=
# Trust configured social providers for automatic account linking by email
AUTH_TRUST_SOCIAL_LINKING=true
# Optional fallback for older setups
AUTH_SECRET=your_super_secret_better_auth_key_here
```

#### **Protocol (HTTP/HTTPS)**

This variable controls whether the application runs in secure (HTTPS) or insecure (HTTP) mode. It affects session cookies and security headers.

```env
# Set to 'false' if running without a reverse proxy or SSL certificate (e.g., direct HTTP).
# Defaults to 'true' for secure HTTPS operation.
HTTPS=true
```

#### **GitHub API (Recommended)**

To avoid being rate-limited by the GitHub API, it is highly recommended to create a [Personal Access Token](https://github.com/settings/personal-access-tokens) with **no scopes** (public repository access is sufficient and more secure).

```env
# Your GitHub Personal Access Token to increase the API rate limit from 60 to 5000 requests/hour.
# Create a token with no scopes (public repo access) for better security.
GITHUB_ACCESS_TOKEN=your_github_pat_here
```

#### **GitLab API (Optional)**

If you want to monitor private GitLab repositories (including self-hosted instances), configure allowed hosts and host-based tokens:
- Access token option: `GITLAB_ACCESS_TOKENS` with scopes `read_api` and `read_repository`.
- Deploy token option: `GITLAB_DEPLOY_TOKENS` with scope `read_repository`.
- For private repositories, ensure the token has at least project role `Reporter` (or higher).

```env
# Optional additional GitLab instances besides gitlab.com (comma-separated).
GITLAB_ADDITIONAL_HOSTS=gitlab.example.com,gitlab.internal.example

# Optional host-based GitLab tokens as comma-separated host=token pairs.
# Example: gitlab.com=glpat_xxx,gitlab.example.com=glpat_yyy
GITLAB_ACCESS_TOKENS=

# Optional host-based GitLab deploy tokens as comma-separated host=username:token pairs.
# Example: gitlab.example.com=gitlab+deploy-token-123:gl-dpt-xyz
GITLAB_DEPLOY_TOKENS=
```

#### **Codeberg API (Optional)**

Codeberg runs on Gitea/Forgejo and exposes a Gitea-compatible REST API. If you want to monitor private repos, set a token:
 - For private repositories, the token typically needs `read:repository`.
 - `read:user` is only needed for diagnostics (e.g. showing the authenticated username on the test page).
 - API limit: 2000 requests per 5 minutes (applies with or without a token).

```env
CODEBERG_ACCESS_TOKEN=your_codeberg_token_here
```

#### **Localization**
Set the timezone for date and log formatting.
```env
# The timezone for the container (e.g., `Europe/Berlin`). Affects log timestamps and date formatting.
TZ=Europe/Berlin
```

#### **Email (SMTP) Configuration (Optional)**

These variables are required if you want to receive email notifications.

```env
# Your SMTP server details.
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USERNAME=your-email@example.com
MAIL_PASSWORD=your_email_password_or_app_token

# The "from" and "to" addresses for notifications.
MAIL_FROM_ADDRESS=notifications@your-domain.com
MAIL_FROM_NAME=GitHub Release Monitor
MAIL_TO_ADDRESS=your-personal-email@example.com
```

#### **Apprise Configuration (Optional)**

Connect to an Apprise service for multi-platform notifications.
```env
# This URL points to your Apprise service's notification endpoint.
#
# Case 1: For stateless notifications via `APPRISE_STATELESS_URLS` in Apprise,
# use the general notify endpoint.
# APPRISE_URL=http://localhost:8000/notify
#
# Case 2: For notifications configured via the Apprise web UI, include the
# specific configuration key in the path.
# APPRISE_URL=http://localhost:8000/notify/your_key
#
# IMPORTANT: The configuration of the actual notification services (e.g., Telegram bots,
# Discord webhooks) is done within the Apprise application itself, either via environment
# variables or its web UI.
APPRISE_URL=
```

### 5. Running the Application

Once your `.env` file is configured, you can run the application in one of two modes:

#### Production Mode
For a production deployment, build and start the application:
```bash
# 1. Build the application for production
npm run build

# 2. Start the production server
npm run start
```
The application will be served on port 3000.

#### Development Mode
For development purposes, you can start the development server which provides features like hot-reloading:
```bash
npm run dev
```
The application will be available at `http://localhost:3000`. On first start, create the initial admin account via setup token (`AUTH_SETUP_TOKEN`), then log in with that account.

---

## 🔄 Migration to 2.0.0

Version 2.0.0 replaces the old `iron-session` username/password login with Better Auth. Existing repository, settings, and notification data in `data/` stay untouched, but existing login sessions are invalidated.

1. Remove the old `AUTH_USERNAME` and `AUTH_PASSWORD` variables from your `.env`.
2. Add `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and a one-time `AUTH_SETUP_TOKEN` with at least 32 characters. You can keep using the old `AUTH_SECRET` value as a fallback secret for now, but `BETTER_AUTH_SECRET` is recommended. `AUTH_SECRET` will be removed in 3.0.0.
3. Keep the existing `data/` directory mounted and writable. Better Auth stores its SQLite database in `data/auth.db` and writes `data/auth-setup.lock` after the first account is created.
4. Start the updated app and open the login page. The first run shows the setup form; enter `AUTH_SETUP_TOKEN` and create the initial admin account. The old `AUTH_USERNAME`/`AUTH_PASSWORD` credentials are not imported automatically.
5. Optional: configure `AUTH_ENABLE_PASSKEY`, `AUTH_ENABLE_SIGNUP`, or the GitHub/Google OAuth variables after the first account exists.

Admin usernames must be 3-30 characters and may contain letters, numbers, `_`, and `.`. Passwords must be at least 12 characters and include uppercase, lowercase, and a number.

---

## 🔐 Social Login Setup (GitHub + Google)

Use this section to create OAuth credentials for the login buttons and map them to:

- `AUTH_GITHUB_CLIENT_ID` / `AUTH_GITHUB_CLIENT_SECRET`
- `AUTH_GOOGLE_CLIENT_ID` / `AUTH_GOOGLE_CLIENT_SECRET`

Official documentation:

- Better Auth GitHub provider: https://www.better-auth.com/docs/authentication/github
- Better Auth Google provider: https://www.better-auth.com/docs/authentication/google
- Better Auth social provider concepts: https://www.better-auth.com/docs/concepts/oauth
- Google Identity branding guidelines (button/logo requirements): https://developers.google.com/identity/branding-guidelines

### 1. Common Requirements

- Set `BETTER_AUTH_URL` to your real app URL (for local dev, usually `http://localhost:3000`).
- After changing OAuth settings, restart the app container.
- With `AUTH_ENABLE_SIGNUP=false`, social login is intended for existing users (first-time users should sign in with password and link providers in Settings if needed).

### 2. GitHub OAuth (OAuth App, not GitHub App)

1. Open: `GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App`
2. Fill in:
   - **Homepage URL**: your app URL (e.g. `http://localhost:3000` or `https://your-domain.tld`)
   - **Authorization callback URL**:
     - Local: `http://localhost:3000/api/auth/callback/github`
     - Production: `https://your-domain.tld/api/auth/callback/github`
3. Create app and copy:
   - **Client ID** -> `AUTH_GITHUB_CLIENT_ID`
   - **Client Secret** -> `AUTH_GITHUB_CLIENT_SECRET`

### 3. Google OAuth (Web application)

1. Open Google Cloud Console:
   - `APIs & Services -> OAuth consent screen` (complete this first)
2. Then:
   - `APIs & Services -> Credentials -> Create Credentials -> OAuth client ID`
   - Choose **Web application**
3. Configure:
   - **Authorized redirect URIs**:
     - Local: `http://localhost:3000/api/auth/callback/google`
     - Production: `https://your-domain.tld/api/auth/callback/google`
   - **Authorized JavaScript origins** (optional but recommended):
     - `http://localhost:3000`
     - `https://your-domain.tld`
4. Copy:
   - **Client ID** -> `AUTH_GOOGLE_CLIENT_ID`
   - **Client Secret** -> `AUTH_GOOGLE_CLIENT_SECRET`

Note: Google OAuth setting changes can take a few minutes (sometimes longer) to propagate.

## ⚙️ Environment Variables

Here is a complete list of all environment variables used by the application.

| Variable              | Description                                                                                               | Required?              | Default                    |
|-----------------------|-----------------------------------------------------------------------------------------------------------|------------------------|----------------------------|
| `ALLOWED_DEV_ORIGINS` | Comma-separated list of allowed origins in development; blocks others in middleware.                      | No (dev only)          | -                          |
| `APPRISE_URL`         | URL of your Apprise service's notification endpoint (e.g., http://host/notify or http://host/notify/key). | No                     | -                          |
| `AUTHENTICATION_METHOD` | Authentication mode: `Basic`, `AllowUnauthenticated`, or `External`. `External` should only be used behind another auth layer. | No | `Basic` |
| `AUTH_LOGIN_LOCKOUT_SECONDS` | Lockout duration (seconds) after too many failed login attempts.                                   | No                     | `900`                      |
| `AUTH_LOGIN_WINDOW_SECONDS` | Time window (seconds) used to count failed login attempts.                                          | No                     | `900`                      |
| `AUTH_MAX_LOGIN_ATTEMPTS` | Maximum failed login attempts before a temporary lockout is applied.                                 | No                     | `5`                        |
| `AUTH_ENABLE_SIGNUP`  | Enables self-service signup when set to `true`. Keep `false` for single-user mode.                     | No                     | `false`                    |
| `AUTH_ENABLE_PASSKEY` | Enables WebAuthn passkey features when set to `true`.                                                   | No                     | `true`                     |
| `AUTH_TRUST_SOCIAL_LINKING` | Trusts configured social providers for automatic account linking by email (`github`, `google`).         | No                     | `true`                     |
| `AUTH_SETUP_TOKEN`    | One-time setup token used to create the first user when no users exist yet.                             | Recommended            | -                          |
| `AUTH_SECRET`         | Backward-compatible fallback for `BETTER_AUTH_SECRET`.                                                   | No                     | -                          |
| `AUTH_GITHUB_CLIENT_ID` | OAuth client ID for GitHub social login.                                                                | No                     | -                          |
| `AUTH_GITHUB_CLIENT_SECRET` | OAuth client secret for GitHub social login.                                                        | No                     | -                          |
| `AUTH_GOOGLE_CLIENT_ID` | OAuth client ID for Google social login.                                                                | No                     | -                          |
| `AUTH_GOOGLE_CLIENT_SECRET` | OAuth client secret for Google social login.                                                        | No                     | -                          |
| `BETTER_AUTH_SECRET`  | Better Auth secret key (minimum 32 characters).                                                          | **Yes**                | -                          |
| `BETTER_AUTH_URL`     | Base URL used by Better Auth (e.g. `http://localhost:3000`).                                            | **Yes**                | -                          |
| `CODEBERG_ACCESS_TOKEN` | A Codeberg access token (Gitea API) for private repos. Typically needs `read:repository`; `read:user` only for diagnostics. | No                     | -                          |
| `GITHUB_ACCESS_TOKEN` | A GitHub Personal Access Token to increase the API rate limit. A token with no scopes is sufficient.      | No (but recommended)   | -                          |
| `GITLAB_ADDITIONAL_HOSTS` | Additional GitLab hosts (without schema/port), comma-separated. `gitlab.com` is always allowed.       | No                     | -                          |
| `GITLAB_ACCESS_TOKENS` | Host-based GitLab tokens as comma-separated `host=token` pairs for private repos.                         | No                     | -                          |
| `GITLAB_DEPLOY_TOKENS` | Host-based GitLab deploy tokens as comma-separated `host=username:token` pairs for private repos.         | No                     | -                          |
| `HTTPS`               | Set to `false` to run in HTTP mode. Defaults to `true` for secure operation.                              | No                     | `true`                     |
| `LOG_LEVEL`           | Controls server log verbosity: `error`, `warn`, `info`, `debug`, `silent`.                                | No                     | `warn` (prod), `debug` (dev) |
| `MAIL_FROM_ADDRESS`   | The email address that notifications will be sent from.                                                   | Yes, for email         | -                          |
| `MAIL_FROM_NAME`      | The display name for the "from" address.                                                                  | No                     | `GitHub Release Monitor`   |
| `MAIL_HOST`           | The hostname or IP address of your SMTP server.                                                           | Yes, for email         | -                          |
| `MAIL_PASSWORD`       | The password or app token for SMTP authentication.                                                        | No (depends on server) | -                          |
| `MAIL_PORT`           | The port for your SMTP server (e.g., 587 or 465).                                                         | Yes, for email         | -                          |
| `MAIL_TO_ADDRESS`     | The email address that will receive the notifications.                                                    | Yes, for email         | -                          |
| `MAIL_USERNAME`       | The username for SMTP authentication.                                                                     | No (depends on server) | -                          |
| `TZ`                  | The timezone for the container (e.g., `Europe/Berlin`). Affects log timestamps and date formatting.       | No                     | System default             |

## Star History

<a href="https://www.star-history.com/#iamspido/github-release-monitor&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date" />
 </picture>
</a>
