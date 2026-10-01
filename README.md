# Gmail To Outlook.com Proxy

**Hosted: https://sendas.email**

Microsoft has discontinued basic authentication for personal Outlook.com accounts. This change affects Gmail's "Send mail as" feature, which relies on basic SMTP authentication. Since Gmail hasn't updated their SMTP integration, users can no longer send emails through Outlook.com accounts via Gmail. Notably, attempts to connect to the Outlook.com SMTP server smtp-mail.outlook.com results in the following error:

```
Authentication failed. Please check your username/password.
Server returned error: "334 VXNlcm5hbWU6 334 UGFzc3dvcmQ6 535 5.7.139 Authentication unsuccessful, basic authentication is disabled. [AS4P251CA0014.EURP251.PROD.OUTLOOK.COM 2024-10-26T21:19:04.955Z 08DCF55F2D078725] , code: 535"
```

This restores that functionality by presenting a compatible SMTP server to Gmail and using the Microsoft Graph `sendMail` endpoint to send the payload. Once authenticated, displays the SMTP credentials to use in Gmail (instead of the ones listed at https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040):

![image](https://github.com/user-attachments/assets/1fb0492b-44fa-4b5e-84e8-cdb80b442c1f)

I've stood up https://sendas.email/ for myself, but all are welcome to use it if you don't want to go through the setup. The only mail permission that is requested is `Mail.Send` (plus `User.Read` to identify your account), which doesn't allow access to your contacts or inbox.

## Setup

1. Have a domain name pointing at the server, a TLS certificate for it (https://certbot.eff.org/) and ports set up as in [Self-hosting: DNS, ports and certificates](#self-hosting-dns-ports-and-certificates), and set `SMTP_HOST`, `SMTP_KEY_FILE`, and `SMTP_CERT_FILE` in the `.env`.
2. Register an app with Microsoft Graph. `deploy/create-entra-app.sh` does steps 2–4 with the Azure CLI from the template in `deploy/entra-app.json` (e.g. `deploy/create-entra-app.sh "Send As" https://<HOST>/auth http://localhost:3000/auth`; the app accepts personal and [work or school accounts](#work-or-school-accounts), add `--personal-only` to limit it to personal accounts) and writes a ready-to-paste `MICROSOFT_APPS` entry (the client secret is valid for 100 years by default, `--years N` to change; apps for personal accounts allow at most 2 secrets, so delete the unused one before adding another); set the publisher domain / verified publisher in the Entra portal afterwards. Manually: register an app (https://learn.microsoft.com/en-us/graph/auth/auth-concepts) with delegated `Mail.Send` and `User.Read` permissions.
3. Configure the app as a Web platform with valid redirect URIs `https://<HOST>/auth` (add `http://localhost:3000/auth` to log in during local development).
4. Generate a client secret for the app and set `MICROSOFT_APPS` in the `.env` to a JSON array of app registrations (multiple are supported). `id` is the app's **Application (client) ID** and `secret` is the client secret's **Value** (shown once when you create it), not its Secret ID. The default app for new users is the first entry, or set `MICROSOFT_APPS_DEFAULT_ID` explicitly:
   ```
   MICROSOFT_APPS=[{"id":"APP_ID_1","secret":"APP_SECRET_1"},{"id":"APP_ID_2","secret":"APP_SECRET_2"}]
   MICROSOFT_APPS_DEFAULT_ID=APP_ID_1
   ```
   The JSON must be on a **single line**: a `.env` value can't span multiple lines, so a multi-line array is read as empty and the build fails with `Unexpected end of JSON input`. Each entry may also set `tenant` and `name`, see [Work or school accounts](#work-or-school-accounts).
5. Generate your own `SESSION_SECRET` (at least 32 characters) to manage session encryption. See [Configuration](#configuration) for the remaining settings.
6. Create the database schema, then start:
   ```
   docker compose run --rm app npm run db:migrate
   docker compose up -d
   ```

## Work or school accounts

Personal Microsoft accounts (Outlook.com, Hotmail, Live) and work or school (Microsoft 365) accounts both sign in on the same page; https://sendas.email accepts both. Each entry in `MICROSOFT_APPS` signs in through its `tenant`: `common` for an app that accepts both kinds of account (what `deploy/create-entra-app.sh` creates), `consumers` (the default when `tenant` is omitted) for an app limited to personal accounts.

- The account needs an Exchange Online mailbox. A work sign-in whose organization uses another mail provider can log in, but sending fails (`450 The mailbox is either inactive…`).
- Depending on the organization's consent policy, users may need an admin to approve the app the first time. Publisher-verified apps are allowed in more organizations.
- The SMTP username shown after signing in is the mailbox's primary address.

**Opening an existing personal-only app to work accounts:** existing users keep working and keep their SMTP password.

1. In the app registration, set **Supported account types** to "Accounts in any organizational directory and personal Microsoft accounts" (`AzureADandPersonalMicrosoftAccount`).
2. Wait until Microsoft has applied the change (usually about a minute; until then sign-ins and refreshes through `common` fail with `AADSTS90023`).
3. Set `"tenant": "common"` on that app's entry in `MICROSOFT_APPS` and restart.

**A single organization only:** register an app in that organization's Entra tenant with "Accounts in this organizational directory only" and add it as an extra entry with its tenant id and a name, e.g. `{"id":"APP_ID","secret":"APP_SECRET","name":"work","tenant":"<TENANT_ID>"}` (inside the single-line `MICROSOFT_APPS` array). Users of that organization sign in at `https://<HOST>/auth?app=work`.

## Local development

```
cp .env.example .env.local   # fill in MICROSOFT_APPS and SESSION_SECRET, leave SMTP_KEY_FILE/SMTP_CERT_FILE empty
npm install
npm run db:migrate           # create/upgrade the local database schema
npm run dev                  # Next.js on :3000 + SMTP server on :587, rebuilt on change
```

`.env.local` overrides `.env` (for both the web app and the SMTP server) and is never committed or copied into the Docker image. To disable TLS locally, set `SMTP_KEY_FILE=` and `SMTP_CERT_FILE=` to empty in `.env.local`.

- **Real login:** add `http://localhost:3000/auth` as a redirect URI on the app registration, then visit http://localhost:3000.
- **No Microsoft at all:** `npm run dev:dry` starts the SMTP server with `SMTP_DRY_RUN=1`, which logs each message instead of sending it through Graph. Create a fake user with `npm run smtp:seed -- you@example.com`.
- **Send a test message:** `npm run smtp:test -- <FROM> <TO>` uses the local server and db. To test the deployed server, pass the host and the password from the configuration page: `SMTP_TEST_PASSWORD=... npm run smtp:test -- <FROM> <TO> smtp.example.com`.

Set `SMTP_PORT` if 587 is taken locally.

### Tests and formatting

- `npm test` runs the tests in `tests/`, including replays of recorded Gmail SMTP sessions (`tests/fixtures/`).
- `npm run format` / `npm run format:check` use the project's pinned Prettier.

## Deploying

Everything server-specific lives in `.env`, `deploy/.env` and `hooks.local.js` (all gitignored), so the checkout on the server should stay clean:

- `.env`: app config, plus `WEB_PORT` / `SMTP_PORT` for the host ports.
- `hooks.local.js`: optional custom `onNewLogin` / `onMailForwarded` hooks (e.g. notifications), see `lib/hooks.ts`.
- `deploy/.env`: certificate domain, Cloudflare credentials path, and S3 backup location (see `deploy/.env.example`).

Scripts (run on the server from anywhere):

- `deploy/update.sh`: `git pull --ff-only`, rebuild and restart; refuses to run if tracked files were edited, and stops without restarting if [database migrations](#database-migrations) are pending.
- `deploy/migrate.sh`: back up the database and apply pending migrations with the newly built image.
- `deploy/logs.sh`, `deploy/shell.sh`: follow logs / open a shell in the container.
- `deploy/renew-certs.sh`: issue or renew the SMTP certificate with certbot + Cloudflare DNS, then reload the SMTP server.
- `deploy/backup.sh`: copy the sqlite db to S3.
- `deploy/daily.sh`: both of the above, run by `deploy/systemd/sendas-daily.timer` as root (root needs the `docker compose` plugin, not just the invoking user):
  ```
  sudo cp deploy/systemd/sendas-daily.* /etc/systemd/system/
  sudo systemctl daemon-reload && sudo systemctl enable --now sendas-daily.timer
  ```

## Database migrations

The SQLite schema is managed by numbered SQL files in `migrations/` (`-- Up` / `-- Down`). They are applied **explicitly**; the apps never change the schema themselves and refuse to start if migrations are pending.

- `npm run db:migrate` applies pending migrations to `SQLITE_PATH`, after writing a snapshot to `data/backups/` (the 3 most recent are kept). `-- --check` lists pending migrations without changing anything and exits non-zero if any are pending.
- It refuses to run against a database migrated by a newer version, rather than undoing migrations it doesn't know.
- On the server: `deploy/update.sh` stops if migrations are pending; review them, run `deploy/migrate.sh`, then run `deploy/update.sh` again. The previous version keeps running until then, so migrations must stay compatible with it.
- New migration: add the next numbered file (e.g. `003-description.sql`). Never edit a migration that has shipped.

## Configuration

Environment variables (`.env`, overridden by `.env.local` in development; see `.env.example`):

| Variable                                      | Purpose                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MICROSOFT_APPS`, `MICROSOFT_APPS_DEFAULT_ID` | App registrations (single-line JSON) and the default for new sign-ins, see [Setup](#setup)                                                                                                    |
| `SESSION_SECRET`, `SESSION_COOKIE`            | Web session encryption secret (32+ characters) and cookie name                                                                                                                                |
| `SQLITE_PATH`                                 | Database file, e.g. `data/db.sqlite`                                                                                                                                                          |
| `SMTP_HOST`                                   | Hostname shown to users as their SMTP server                                                                                                                                                  |
| `SMTP_KEY_FILE`, `SMTP_CERT_FILE`             | TLS key and certificate for the SMTP server (empty disables TLS, for local development)                                                                                                       |
| `SMTP_PORT`                                   | SMTP listen port locally; host port in docker compose (default 587)                                                                                                                           |
| `WEB_PORT`                                    | Host port for the web app in docker compose (default 3000)                                                                                                                                    |
| `CERTIFICATES_DIR`                            | Host directory mounted at `certificates/` in docker compose (default `./certificates`), see [Self-hosting](#self-hosting-dns-ports-and-certificates)                                          |
| `SMTP_MERGE_WINDOW_MS`, `SMTP_MERGE_MAX_MS`   | How long to wait for more copies of a message before sending (default 5000), and the cap from the first copy (default 60000), see [Multiple recipients and Bcc](#multiple-recipients-and-bcc) |
| `SMTP_DRY_RUN`                                | Log messages instead of sending them through Graph                                                                                                                                            |

## Multiple recipients and Bcc

Gmail's "Send mail as" delivers a message with several recipients as **one SMTP connection per recipient**, each carrying the same message (same `Message-ID`); only a Bcc recipient's own copy has a `Bcc:` header naming them. Microsoft Graph sends to the To/Cc/Bcc headers of the message and has no separate envelope, so forwarding each copy would duplicate the message for every recipient, and forwarding only the first would lose the Bcc recipients.

The SMTP server therefore holds the copies of a message (grouped by the signed-in user and `Message-ID`) until no new copy has arrived for `SMTP_MERGE_WINDOW_MS`, then sends **one** message whose `Bcc:` names every Bcc recipient. Gmail is answered only after Microsoft accepts it, so failures are reported and retried. On shutdown (`docker stop`, `pm2 reload`) the server stops accepting connections and sends everything it is holding before exiting.

## Limitations

These come from Microsoft Graph and Exchange, not from the proxy:

- **From address:** messages are sent from the mailbox's **primary** address. A `From:` set to an alias is replaced with the primary address, and a `From:` the account doesn't own is rejected (the proxy answers `550` so the client bounces immediately).
- **Accounts that sign in with a non-Microsoft address** (e.g. a Gmail address) have an auto-generated mailbox address like `outlook_<id>@outlook.com`, which is what recipients see and which spam filters may flag. Make an outlook.com alias the primary address at account.microsoft.com to avoid this.
- **Headers:** `Message-ID`, `In-Reply-To` and `References` (reply threading) are kept; custom `X-` headers and the original `Date` are replaced by Exchange, and the `From:` display name is replaced with the Microsoft account's name.
- **Late Bcc copies:** if a Bcc recipient's copy arrives after the merge window, that recipient is not sent the message (Graph delivers to whoever is in the headers, so adding them would re-send it to everyone); the server logs a warning. Gmail sends all copies within about a second, well inside the window.

## Why Graph `sendMail` instead of SMTP

Microsoft still accepts OAuth on its own SMTP servers (`smtp-mail.outlook.com`, `smtp.office365.com`) through `AUTH XOAUTH2` with the delegated `SMTP.Send` permission, so a proxy could instead relay Gmail's SMTP transactions unchanged, as [microsoft-smtp-oauth2-proxy](https://github.com/oldium/microsoft-smtp-oauth2-proxy) does. That keeps the envelope, so Bcc needs no merging. This project sends through Microsoft Graph instead, because relaying over SMTP behaves worse for Gmail's "Send mail as" in practice:

|                                            | Graph `sendMail` (this project)                                             | SMTP relay with `SMTP.Send`                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reply threading                            | `Message-ID` kept, so replies thread with the message in Gmail's Sent       | Outlook.com's SMTP server replaces `Message-ID` (the original survives only as `X-Microsoft-Original-Message-ID`), so the first reply arrives in a separate conversation, and each per-recipient copy gets a different ID |
| Work or school accounts                    | Work regardless of the organization's SMTP settings                         | Fail wherever SMTP AUTH is disabled, the default for Microsoft 365 tenants created since 2020                                                                                                                             |
| Personal accounts                          | All work                                                                    | Some mailboxes refuse SMTP sign-in (`535 5.7.3`) even with a valid `SMTP.Send` token                                                                                                                                      |
| Gmail's parallel per-recipient connections | Merged into one message                                                     | Exceed Microsoft's concurrent SMTP connections per mailbox (`432 4.3.2`), so submissions must be queued per user                                                                                                          |
| Bcc                                        | Merged into one message's `Bcc:`, see [above](#multiple-recipients-and-bcc) | Delivered natively from the envelope                                                                                                                                                                                      |
| `From:` display name, `Date`, `X-` headers | Replaced or stripped                                                        | Kept                                                                                                                                                                                                                      |
| Permission                                 | `Mail.Send`                                                                 | `SMTP.Send` on top, so every existing user would have to sign in and consent again                                                                                                                                        |

Implementation notes for anyone adding an SMTP path:

- A login can't combine `https://graph.microsoft.com/.default` with another API's scope (`AADSTS70011`): list `Mail.Send`, `User.Read` and `https://outlook.office.com/SMTP.Send` explicitly, and redeem the code for one API at a time. The stored refresh token then yields an SMTP access token with `scope=https://outlook.office.com/SMTP.Send`.
- `SMTP.Send` (Microsoft Graph permission `258f6531-6087-4cc4-bb90-092c5fb3ed3f`) can be consented to by users; until they do, the token request fails with `AADSTS70000` (personal) or `AADSTS65001` (work).
- Both SMTP hosts reach the same Exchange Online front ends and accept the same tokens; the `XOAUTH2` user is the account's email address.

## Self-hosting: DNS, ports and certificates

Two hostnames are involved, and they can be the same name: the web app's (the redirect URI registered with Microsoft, `https://<HOST>/auth`) and the SMTP server's (`SMTP_HOST`, which users enter in Gmail).

- **DNS:** point both at the server (a dynamic DNS name works for a home server).
- **SMTP port 587:** forward TCP 587 from the router/firewall to the host (`SMTP_PORT` changes the host port). Gmail only talks to it with STARTTLS, so the SMTP server needs a valid, trusted certificate for `SMTP_HOST`. Some residential ISPs block inbound mail ports.
- **Web app over HTTPS:** Microsoft only accepts `https://` redirect URIs (except `http://localhost`). The web app listens on plain HTTP on `WEB_PORT` (default 3000), so put a reverse proxy with a certificate in front of it (nginx, Caddy, a Cloudflare tunnel, …) forwarding `https://<HOST>` to `http://127.0.0.1:3000`, and forward 443 (and 80 if the proxy issues its certificates over HTTP).
- **Certificates in the container:** docker compose mounts `CERTIFICATES_DIR` (default `./certificates`) read-only at `/app/certificates`, and `SMTP_KEY_FILE` / `SMTP_CERT_FILE` are paths inside that directory, e.g. `certificates/live/<SMTP_HOST>/privkey.pem` and `certificates/live/<SMTP_HOST>/fullchain.pem`. With certbot installed on the host, set `CERTIFICATES_DIR=/etc/letsencrypt` in `.env`: mount the whole directory, since the files in `live/` are relative symlinks into `archive/`. The container runs as root, so the root-only private key is readable.
- **Renewals:** the SMTP server reads the certificate when it starts. Reload it after each renewal, e.g. a certbot deploy hook running `docker compose -f <checkout>/docker-compose.yml exec -T app pm2 reload pm2.json --only sendas-smtp` (`deploy/renew-certs.sh` does this for its own certificates).
- **`.env` changes** are built into the image: rebuild with `docker compose up -d --build` (or `deploy/update.sh`).

**Troubleshooting:** if the web app works but Gmail can't connect, check the logs (`deploy/logs.sh` or `docker compose logs app`). An unreadable certificate stops the SMTP server with `SMTP server not starting: can't read SMTP_KEY_FILE / SMTP_CERT_FILE (…)` while the web app keeps running. From outside the network, `openssl s_client -starttls smtp -connect <SMTP_HOST>:587 -servername <SMTP_HOST>` should show the certificate chain and a `250` reply; a timeout means the port isn't reachable (forwarding, firewall or ISP).

### Issuing certificates with certbot and DNS

With Cloudflare DNS, `deploy/renew-certs.sh` issues and renews the certificate into `./certificates` (and reloads the SMTP server) using the settings in `deploy/.env`. With Route53:

Reference: https://certbot-dns-route53.readthedocs.io/en/stable/

```
docker run --rm -v \
  "$(pwd)/certificates:/etc/letsencrypt/" \
  -e "AWS_ACCESS_KEY_ID=<YOUR_KEY_ID>" \
  -e "AWS_SECRET_ACCESS_KEY=<YOUR_SECRET_KEY>" \
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

## Certificates (Cloudflare)

Reference: https://certbot-dns-cloudflare.readthedocs.io/en/stable/

```
docker run --rm -v \
  "$(pwd)/certificates:/etc/letsencrypt/" \
  -v "<LOCAL_SECRET_FILE>:/root/.secrets/cloudflare.ini" \
  certbot/dns-cloudflare \
  certonly \
  --non-interactive \
  --agree-tos \
  --key-type rsa \
  --cert-name <YOUR_SMTP_HOST> \
  --email <YOUR_EMAIL> \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d <YOUR_SMTP_HOST>
```

Then update:

- `SMTP_KEY_FILE`: `certificates/live/<YOUR_SMTP_HOST>/privkey.pem`
- `SMTP_CERT_FILE`: `certificates/live/<YOUR_SMTP_HOST>/fullchain.pem`

## Usage

Usage is pretty straightforward, visit the web app (http://localhost:3000 by default) and authenticate with your Microsoft account (Outlook.com, or a work or school account if [enabled](#work-or-school-accounts)). You'll then be presented with SMTP credentials to use with Gmail.

To send a test message from the server, open a shell in the container with `deploy/shell.sh` and use `npm run smtp:test` (see [Local development](#local-development)).
