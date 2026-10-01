import "source-map-support/register.js";
import "./env.js";
import crypto from "node:crypto";
import { getUser, upsert } from "../lib/db";

// usage: npm run smtp:seed -- <EMAIL>
// creates a fake user (no Microsoft token) for testing with SMTP_DRY_RUN=1
(async () => {
  const [email] = process.argv.slice(2);
  if (!email) {
    throw new Error("Usage: npm run smtp:seed -- <EMAIL>");
  }
  await upsert(
    "Tokens",
    [
      {
        email,
        token: JSON.stringify({}),
        smtp_password: crypto.randomBytes(16).toString("hex"),
        updated_at: new Date().toISOString(),
        app_id: null,
      },
    ],
    { ignoreIfSetFields: ["smtp_password", "token", "app_id"] }
  );
  const user = await getUser(email);
  console.log(`Seeded ${email}, SMTP password: ${user!.smtp_password}`);
})();
