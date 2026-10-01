import "source-map-support/register.js";
import "./env.js";
import nodemailer from "nodemailer";
import { getUser } from "../lib/db";

// usage: npm run smtp:test -- <FROM_EMAIL> <TO_EMAIL> [HOST]
// against localhost the SMTP password is read from the local db,
// otherwise set SMTP_TEST_PASSWORD (copy it from the configuration page)
(async () => {
  const [from, to, host = "localhost"] = process.argv.slice(2);
  if (!from || !to) {
    throw new Error("Usage: npm run smtp:test -- <FROM> <TO> [HOST]");
  }

  const isLocal = host === "localhost";
  const password = isLocal
    ? (await getUser(from))?.smtp_password
    : process.env.SMTP_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      isLocal
        ? `User ${from} not found in the local db.`
        : "Set SMTP_TEST_PASSWORD to test against a remote host."
    );
  }

  const transporter = nodemailer.createTransport({
    host,
    port: Number(isLocal ? process.env.SMTP_PORT || 587 : 587),
    auth: {
      user: from,
      pass: password,
    },
    tls: {
      // local server uses a self-signed or mismatched cert
      rejectUnauthorized: !isLocal,
    },
  });

  await transporter.sendMail({
    to,
    from,
    subject: "Hello!",
    text: "Hello from your relay!",
  });

  console.log(`Sent from ${from} to ${to} via ${host}.`);
})();
