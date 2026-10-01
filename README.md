# Gmail To Outlook.com Proxy

**Hosted: https://sendas.email**

Microsoft has discontinued basic authentication for personal Outlook.com accounts. This change affects Gmail's "Send mail as" feature, which relies on basic SMTP authentication. Since Gmail hasn't updated their SMTP integration, users can no longer send emails through Outlook.com accounts via Gmail. Notably, attempts to connect to the Outlook.com SMTP server smtp-mail.outlook.com results in the following error:

```
Authentication failed. Please check your username/password.
Server returned error: "334 VXNlcm5hbWU6 334 UGFzc3dvcmQ6 535 5.7.139 Authentication unsuccessful, basic authentication is disabled. [AS4P251CA0014.EURP251.PROD.OUTLOOK.COM 2024-10-26T21:19:04.955Z 08DCF55F2D078725] , code: 535"
```

This restores that functionality by presenting a compatible SMTP server to Gmail and using the Microsoft Graph `sendMail` endpoint to send the payload. Once authenticated, displays the SMTP credentials to use in Gmail (instead of the ones listed at https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040):

![image](https://github.com/user-attachments/assets/1fb0492b-44fa-4b5e-84e8-cdb80b442c1f)

I've stood up https://sendas.email/ for myself, but all are welcome to use it if you don't want to go through the setup. The only permission that is requested is `Mail.Send`, which doesn't allow access to your contacts or inbox.

## Setup

1. Have a domain name with valid SSL certificates (https://certbot.eff.org/) and update `SMTP_HOST`, `SMTP_KEY_FILE`, and `SMTP_CERT_FILE` in the `.env`.
2. Register an app with Microsoft Graph (https://learn.microsoft.com/en-us/graph/auth/auth-concepts) with delegated `Mail.Send` and `User.Read` permissions.
3. Configure the app as a Web platform with valid redirect URIs `https://<HOST>/auth` (add `http://localhost:3000/auth` to log in during local development).
4. Generate a client secret for the app and update `MICROSOFT_APPS` in the `.env` (supports multiple app registrations). The default app for new users will be the first entry OR set `MICROSOFT_APPS_DEFAULT_ID` explicitly.
   ```
   [
     {
       "id": "APP_ID_1",
       "secret": "APP_SECRET_1"
     },
     {
       "id": "APP_ID_2",
       "secret": "APP_SECRET_2"
     }
   ]
   ```
   Each entry may also set `tenant` and `name`, see [Work or school accounts](#work-or-school-accounts).
5. Generate your own `SESSION_SECRET` to manage session encryption.
6. `docker-compose up`

## Work or school accounts

By default apps sign in through the `consumers` endpoint, which only accepts personal Microsoft accounts. To send from a Microsoft 365 (work or school) mailbox:

1. In that organization's Entra admin center, register a new app with supported account types "Accounts in this organizational directory only", a Web redirect URI `https://<HOST>/auth`, and delegated `Mail.Send` + `User.Read` permissions.
2. Grant admin consent for the organization (most tenants don't let users consent to unverified apps themselves).
3. Add it to `MICROSOFT_APPS` with the tenant id and a name:
   ```
   {"id": "APP_ID", "secret": "APP_SECRET", "name": "work", "tenant": "<TENANT_ID>"}
   ```
4. Sign in at `https://<HOST>/auth?app=work`. The SMTP username is the mailbox's primary address.

`tenant` can also be `organizations` or `common` for a multi-tenant app, but other organizations' admins would need to consent to it.

## Local development

```
cp .env.example .env.local   # fill in MICROSOFT_APPS and SESSION_SECRET, leave SMTP_KEY_FILE/SMTP_CERT_FILE empty
npm install
npm run dev                  # Next.js on :3000 + SMTP server on :587, rebuilt on change
```

`.env.local` overrides `.env` (for both the web app and the SMTP server) and is never committed or copied into the Docker image. To disable TLS locally, set `SMTP_KEY_FILE=` and `SMTP_CERT_FILE=` to empty in `.env.local`.

- **Real login:** add `http://localhost:3000/auth` as a redirect URI on the app registration, then visit http://localhost:3000.
- **No Microsoft at all:** `npm run dev:dry` starts the SMTP server with `SMTP_DRY_RUN=1`, which logs each message instead of sending it through Graph. Create a fake user with `npm run smtp:seed -- you@example.com`.
- **Send a test message:** `npm run smtp:test -- <FROM> <TO>` uses the local server and db. To test the deployed server, pass the host and the password from the configuration page: `SMTP_TEST_PASSWORD=... npm run smtp:test -- <FROM> <TO> smtp.example.com`.

Set `SMTP_PORT` if 587 is taken locally.

## Deploying

Everything server-specific lives in `.env`, `deploy/.env` and `hooks.local.js` (all gitignored), so the checkout on the server should stay clean:

- `.env`: app config, plus `WEB_PORT` / `SMTP_PORT` for the host ports.
- `hooks.local.js`: optional custom `onNewLogin` / `onMailForwarded` hooks (e.g. notifications), see `lib/hooks.ts`.
- `deploy/.env`: certificate domain, Cloudflare credentials path, and S3 backup location (see `deploy/.env.example`).

Scripts (run on the server from anywhere):

- `deploy/update.sh`: `git pull --ff-only` and rebuild; refuses to run if tracked files were edited.
- `deploy/logs.sh`, `deploy/shell.sh`: follow logs / open a shell in the container.
- `deploy/renew-certs.sh`: issue or renew the SMTP certificate with certbot + Cloudflare DNS, then reload the SMTP server.
- `deploy/backup.sh`: copy the sqlite db to S3.
- `deploy/daily.sh`: both of the above, run by `deploy/systemd/sendas-daily.timer`:
  ```
  sudo cp deploy/systemd/sendas-daily.* /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now sendas-daily.timer
  ```

## Certificates (Route53)

Reference: https://certbot-dns-route53.readthedocs.io/en/stable/

```
docker run --rm -v \
  "$(pwd)/certificates:/etc/letsencrypt/" \
  -e "AWS_ACCESS_KEY_ID=<YOUR_KEY_ID>" \
  -e "AWS_SECRET_ACCESS_KEY=<YOUR_SECRET_KEY" \
  certbot/dns-route53 \
  certonly \
  --non-interactive \
  --agree-tos \
  --email <YOUR_EMAIL> \
  --dns-route53 \
  -d <YOUR_SMTP_HOST>
```

Then update:

- `SMTP_KEY_FILE`: `certificates/live/<YOUR_SMTP_HOST>/privkey.pem`
- `SMTP_CERT_FILE`: `certificates/live/<YOUR_SMTP_HOST>/fullchain.pem`

## Usage

Usage is pretty straightforward, visit the web app (http://localhost:3000 by default) and authenticate into your Outlook.com account. You'll then be presented with SMTP credentials to use with Gmail.

You can test send after authenticating by entering the docker shell (`deploy/shell.sh`) and using:

```
npm run smtp:test -- <OUTLOOK_EMAIL> <TARGET_EMAIL>
```

This is configured to ignore cert errors (since it'll be using localhost for the SMTP connection). Your cert will need to be valid for Gmail to connect to it.
