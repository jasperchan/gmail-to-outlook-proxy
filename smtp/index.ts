import "source-map-support/register.js";
import "./env.js";
import {
  getApp,
  getCredentials,
  getMicrosoftGraphClient,
  MicrosoftOAuthCredentials,
} from "../lib/microsoft.js";
import fs from "node:fs";
import { getDb, getUser, User } from "../lib/db.js";
import { onMailForwarded } from "../lib/hooks.js";
import { createSmtpServer } from "./server.js";

type SessionUser = {
  email: string;
  user: User;
  credentials: MicrosoftOAuthCredentials;
};

// TLS for STARTTLS; without it Gmail refuses the server, so an unreadable certificate
// stops the SMTP server with a clear message instead of silently running without TLS
function readCertificate() {
  const { SMTP_KEY_FILE: keyFile, SMTP_CERT_FILE: certFile } = process.env;
  if (!keyFile && !certFile) {
    return {};
  }
  try {
    if (!keyFile || !certFile) {
      throw new Error("set both or neither");
    }
    return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
  } catch (err: any) {
    console.error(
      `SMTP server not starting: can't read SMTP_KEY_FILE / SMTP_CERT_FILE (${err.message})`
    );
    process.exit(1);
  }
}

const cert = readCertificate();

// SMTP_DRY_RUN=1 skips Microsoft entirely: no token refresh, no sendMail, message is logged
const dryRun = /^(1|true|yes|on)$/i.test(process.env.SMTP_DRY_RUN ?? "");

// optional overrides for how long to wait for more copies of a message (see server.ts)
const envMs = (name: string) =>
  process.env[name] ? Number(process.env[name]) : undefined;

const { server, drain } = createSmtpServer<SessionUser>({
  serverOptions: cert,
  mergeWindowMs: envMs("SMTP_MERGE_WINDOW_MS"),
  maxWaitMs: envMs("SMTP_MERGE_MAX_MS"),
  async authenticate(username, password) {
    const user = await getUser(username);
    if (!user || user.smtp_password !== password) {
      throw new Error("Invalid username or password.");
    }
    const credentials = dryRun
      ? user.token
      : await getCredentials(user.email, user.email, getApp(user.app_id));
    return { email: user.email, user, credentials };
  },
  async send(sessionUser, raw) {
    if (dryRun) {
      console.log(`[dry run] ${sessionUser.email}\n${raw.toString()}`);
      return;
    }
    try {
      await getMicrosoftGraphClient(sessionUser.credentials)
        .api("/me/sendMail")
        .header("Content-Type", "text/plain")
        .post(raw.toString("base64"));
    } catch (err: any) {
      // Graph rejecting the message (e.g. SendAsDenied for a From the mailbox doesn't
      // own) is permanent: answer 550 so the client bounces now instead of retrying
      // for days. Throttling, server errors and network failures stay temporary.
      const status = Number(err?.statusCode);
      err.responseCode =
        status >= 400 && status < 500 && status !== 429 ? 550 : 451;
      throw err;
    }
  },
  onSent(sessionUser, raw) {
    onMailForwarded(sessionUser.email, raw.toString("base64"));
  },
});

const port = Number(process.env.SMTP_PORT || 587);
if (!Number.isInteger(port)) {
  throw new Error(`Invalid SMTP_PORT: ${process.env.SMTP_PORT}`);
}
// check the schema before accepting connections: fail fast instead of on the first login
getDb().then(
  () =>
    server.listen(port, () => {
      console.log(
        `SMTP server listening on port ${port}${dryRun ? " (dry run)" : ""}`
      );
    }),
  (err) => {
    console.error(`SMTP server not starting: ${err.message ?? err}`);
    process.exit(1);
  }
);

// docker stop / pm2 reload: finish everything already accepted before exiting
// (keep pm2's kill_timeout and compose's stop_grace_period above the drain timeout)
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    if (stopping) {
      console.log(`SMTP server: second ${signal}, exiting now`);
      process.exit(1);
    }
    stopping = true;
    console.log(`SMTP server: ${signal}, draining`);
    const { leftover } = await drain();
    console.log(
      leftover
        ? `SMTP server exiting with ${leftover} unfinished transaction(s)`
        : "SMTP server drained, exiting"
    );
    process.exit(leftover ? 1 : 0);
  });
}
