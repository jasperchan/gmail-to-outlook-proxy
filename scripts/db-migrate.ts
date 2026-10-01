import "../smtp/env.js";
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { migrationStatus, runMigrations } from "../lib/migrations.js";

// usage: npm run db:migrate [-- --check]
//   --check  print pending migrations, change nothing, exit 2 if any are pending
// Applies pending schema migrations to SQLITE_PATH. Before changing anything it
// writes a consistent snapshot (VACUUM INTO) next to the database, keeping the 3
// most recent, so a bad migration can be undone by restoring that file.
(async () => {
  const filename = process.env.SQLITE_PATH;
  if (!filename) {
    throw new Error("SQLITE_PATH is not set.");
  }
  const db = await open({ filename, driver: sqlite3.Database });
  try {
    const { pending, unknown } = await migrationStatus(db);
    console.log(
      `Database ${filename}: ${pending.length} pending migration(s)${
        pending.length
          ? ` (${pending.map((m) => `${m.id}-${m.name}`).join(", ")})`
          : ""
      }${unknown.length ? `, unknown applied: ${unknown.join(", ")}` : ""}`
    );
    if (process.argv.includes("--check")) {
      process.exitCode = pending.length || unknown.length ? 2 : 0;
      return;
    }
    if (!pending.length && !unknown.length) {
      return;
    }

    const backupDir = path.join(path.dirname(filename), "backups");
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = path.join(backupDir, `${path.basename(filename)}.${stamp}`);
    await db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
    fs.chmodSync(backup, 0o600);
    console.log(`Backup written to ${backup}`);
    // keep only the 3 most recent backups (they hold tokens, don't accumulate)
    fs.readdirSync(backupDir)
      .filter((f) => f.startsWith(`${path.basename(filename)}.`))
      .sort()
      .slice(0, -3)
      .forEach((f) => fs.rmSync(path.join(backupDir, f)));

    const applied = await runMigrations(db);
    console.log(
      `Applied ${applied.length} migration(s): ${applied
        .map((m) => `${m.id}-${m.name}`)
        .join(", ")}`
    );
  } finally {
    await db.close();
  }
})().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
