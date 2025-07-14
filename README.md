
# GitHub Release Monitor

A powerful, self-hostable application to automatically monitor GitHub repository releases and receive instant email notifications. Keep track of your favorite projects without manually checking for updates.

## ✨ Key Features

- **Automated Release Monitoring**: Add public GitHub repositories and let the app automatically check for new releases in the background.
- **Email Notifications**: Configure SMTP settings to receive detailed email notifications the moment a new release is detected.
- **Flexible Release Filtering**:
    - **Global Settings**: Define which release types (stable, pre-release, draft) to monitor application-wide.
    - **Per-Repository Overrides**: Customize filtering rules for individual repositories.
    - **Pre-release Granularity**: Select specific pre-release tags to watch (e.g., `alpha`, `beta`, `rc`).
- **Modern & Responsive UI**:
    - Clean, intuitive interface built with ShadCN UI and Tailwind CSS.
    - Full dark mode support.
    - Responsive design for both desktop and mobile use.
- **Internationalization (i18n)**: Supports English and German out of the box.
- **Data Management**: Easily import or export your list of monitored repositories via JSON.
- **System Diagnostics**: A built-in test page to verify GitHub API connectivity and email (SMTP) configuration.
- **Secure Authentication**: Protects the application with a simple username/password login system powered by `iron-session`.

<table>
  <tr>
    <td><img width="2558" height="1277" alt="Image" src="https://github.com/user-attachments/assets/b541ef9c-dc10-4e20-97a8-75ecc7ed763a" /></td>
    <td><img width="2558" height="1277" alt="Image" src="https://github.com/user-attachments/assets/53671406-a0bc-43d4-8aa4-b77889170f98" /></td>
  </tr>
  <tr>
    <td><img width="2558" height="1276" alt="Image" src="https://github.com/user-attachments/assets/5e28e95f-6089-4a1e-8971-cacb04aba751" /></td>
    <td><img width="2558" height="1275" alt="Image" src="https://github.com/user-attachments/assets/c5e1b82b-84e4-4378-adee-f460da589c79" /></td>
  </tr>
</table>

## 🛠️ Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (App Router)
- **UI**: [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Tailwind CSS](https://tailwindcss.com/), [ShadCN UI](https://ui.shadcn.com/)
- **Internationalization**: [next-intl](https://next-intl.dev/)
- **Authentication**: [iron-session](https://github.com/vvo/iron-session)
- **Email**: [Nodemailer](https://nodemailer.com/)

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
   # A long, random string (at least 32 characters) used to encrypt session cookies.
   # You can generate one using: openssl rand -base64 32
   AUTH_SECRET=your_super_secret_session_password_here
   
   # The username and password for logging into the application.
   AUTH_USERNAME=admin
   AUTH_PASSWORD=your_secure_password
   ```

   **GitHub API (Recommended)**
   To avoid being rate-limited, it is highly recommended to create a [Personal Access Token](https://github.com/settings/personal-access-tokens) with **no scopes** (public repository access is sufficient and more secure).
   ```env
   # Your GitHub Personal Access Token to increase the API rate limit from 60 to 5000 requests/hour.
   # Create a token with no scopes (public repo access) for better security.
   GITHUB_ACCESS_TOKEN=your_github_pat_here
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

## 🐳 Deployment (Docker Run)

If you prefer not to use Docker Compose, you can run the application using a single Docker command.

### 1. Prepare Data Directory and Run Container
Create a host directory for the application data and set the correct permissions before running the container.
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
# A long, random string (at least 32 characters) used to encrypt session cookies.
# You can generate one using: openssl rand -base64 32
AUTH_SECRET=your_super_secret_session_password_here

# The username and password for logging into the application.
AUTH_USERNAME=admin
AUTH_PASSWORD=your_secure_password
```

#### **GitHub API (Recommended)**

To avoid being rate-limited by the GitHub API, it is highly recommended to create a [Personal Access Token](https://github.com/settings/personal-access-tokens) with **no scopes** (public repository access is sufficient and more secure).

```env
# Your GitHub Personal Access Token to increase the API rate limit from 60 to 5000 requests/hour.
# Create a token with no scopes (public repo access) for better security.
GITHUB_ACCESS_TOKEN=your_github_pat_here
```

#### **Email (SMTP) Configuration (Optional)**

These variables are required if you want to receive email notifications for new releases.

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
The application will be available at `http://localhost:3000`. Log in with the `AUTH_USERNAME` and `AUTH_PASSWORD` you configured.

---

## ⚙️ Environment Variables

Here is a complete list of all environment variables used by the application.

| Variable              | Description                                                                                             | Required?             | Default                    |
|-----------------------|---------------------------------------------------------------------------------------------------------|-----------------------|----------------------------|
| `AUTH_SECRET`         | A secret key (at least 32 characters) for encrypting user sessions.                                     | **Yes**               | -                          |
| `AUTH_USERNAME`       | The username for logging into the application.                                                          | **Yes**               | -                          |
| `AUTH_PASSWORD`       | The password for logging into the application.                                                          | **Yes**               | -                          |
| `GITHUB_ACCESS_TOKEN` | A GitHub Personal Access Token to increase the API rate limit. A token with no scopes is sufficient.      | No (but recommended)  | -                          |
| `MAIL_HOST`           | The hostname or IP address of your SMTP server.                                                         | Yes, for email        | -                          |
| `MAIL_PORT`           | The port for your SMTP server (e.g., 587 or 465).                                                       | Yes, for email        | -                          |
| `MAIL_USERNAME`       | The username for SMTP authentication.                                                                   | No (depends on server) | -                          |
| `MAIL_PASSWORD`       | The password or app token for SMTP authentication.                                                      | No (depends on server) | -                          |
| `MAIL_FROM_ADDRESS`   | The email address that notifications will be sent from.                                                 | Yes, for email        | -                          |
| `MAIL_FROM_NAME`      | The display name for the "from" address.                                                                | No                    | `GitHub Release Monitor`   |
| `MAIL_TO_ADDRESS`     | The email address that will receive the notifications.                                                  | Yes, for email        | -                          |
| `TZ`                  | The timezone for the container (e.g., `Europe/Berlin`). Affects log timestamps and date formatting.     | No                    | System default             |

## Star History

<a href="https://www.star-history.com/#iamspido/github-release-monitor&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=iamspido/github-release-monitor&type=Date" />
 </picture>
</a>
