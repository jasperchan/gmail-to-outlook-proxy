import "source-map-support/register.js";
import "./env.js";
import Server from "smtp-server";
import {
  getApp,
  getCredentials,
  getMicrosoftGraphClient,
  MicrosoftOAuthCredentials,
} from "../lib/microsoft.js";
import fs from "node:fs";
import { getUser, User } from "../lib/db.js";
import { onMailForwarded } from "../lib/hooks.js";
import Cache from "node-cache";

type SessionUser = {
  user: User;
  credentials: MicrosoftOAuthCredentials;
};

const cert =
  process.env.SMTP_KEY_FILE && process.env.SMTP_CERT_FILE
    ? {
        key: fs.readFileSync(process.env.SMTP_KEY_FILE),
        cert: fs.readFileSync(process.env.SMTP_CERT_FILE),
      }
    : {};

const cache = new Cache({ stdTTL: 60, checkperiod: 60 });

// SMTP_DRY_RUN=1 skips Microsoft entirely: no token refresh, no sendMail, message is logged
const dryRun = /^(1|true|yes|on)$/i.test(process.env.SMTP_DRY_RUN ?? "");

const server = new Server.SMTPServer({
  authMethods: ["PLAIN", "LOGIN"],
  onConnect(session, callback) {
    return callback();
  },
  ...cert,
  async onAuth(auth, session, callback) {
    try {
      const user = await getUser(auth.username);
      if (!user || user.smtp_password !== auth.password) {
        throw new Error("Invalid username or password.");
      }
      const credentials = dryRun
        ? user.token
        : await getCredentials(user.email, user.email, getApp(user.app_id));
      callback(null, {
        user: {
          user,
          credentials,
        } as SessionUser,
      });
    } catch (err: any) {
      console.error(
        `Auth failed for ${JSON.stringify(auth.username)}:`,
        err?.message ?? err
      );
      callback(new Error("Invalid username or password."));
    }
  },
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream
      .on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      })
      .on("error", (err) => callback(err))
      .on("end", async () => {
        try {
          const raw = Buffer.concat(chunks);
          const msg = raw.toString("base64");
          // unfortunately, gmail seems to send the same message multiple times when sending to multiple recipients so we must dedupe
          const messageId = raw.toString().match(/^Message-ID: (.*)$/im)?.[1];
          if (messageId) {
            if (cache.get(messageId)) {
              return callback();
            }
            cache.set(messageId, true);
          }
          const sessionUser = session.user as any as SessionUser;
          if (dryRun) {
            console.log(
              `[dry run] ${sessionUser.user.email} -> ${session.envelope.rcptTo
                .map((r) => r.address)
                .join(", ")}\n${raw.toString()}`
            );
            return callback();
          }
          const client = getMicrosoftGraphClient(sessionUser.credentials);
          await client
            .api("/me/sendMail")
            .header("Content-Type", "text/plain")
            .post(msg);
          onMailForwarded(sessionUser.user.email, msg);
          callback();
        } catch (err: any) {
          callback(err);
        }
      });
  },
}).on("error", (err) => {
  // prevent unhandled error from crashing the server
  console.log(err);
});

const port = Number(process.env.SMTP_PORT || 587);
if (!Number.isInteger(port)) {
  throw new Error(`Invalid SMTP_PORT: ${process.env.SMTP_PORT}`);
}
server.listen(port, () => {
  console.log(
    `SMTP server listening on port ${port}${dryRun ? " (dry run)" : ""}`
  );
  process.on("SIGINT", () => {
    console.log("SMTP server shutting down");
    cache.close();
    server.close(() => {
      console.log("SMTP server exiting");
      process.exit(0);
    });
  });
});
