import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { migrationStatus, runMigrations } from "../lib/migrations.js";

const MIGRATIONS = path.join(process.cwd(), "migrations");

function tempDbPath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "sendas-db-")),
    "db.sqlite"
  );
}

const openDb = (filename: string) =>
  open({ filename, driver: sqlite3.Database });

const hasIndex = async (db: Awaited<ReturnType<typeof openDb>>) =>
  !!(await db.get(
    "SELECT name FROM sqlite_master WHERE name = 'Tokens_email_nocase'"
  ));

test("db:migrate applies all migrations to a fresh database, once", async () => {
  const db = await openDb(tempDbPath());
  const applied = await runMigrations(db, MIGRATIONS);
  assert.deepEqual(
    applied.map((m) => m.id),
    [1, 2]
  );
  assert.ok(await hasIndex(db));
  assert.deepEqual(await runMigrations(db, MIGRATIONS), []);
  assert.deepEqual(await migrationStatus(db, MIGRATIONS), {
    pending: [],
    unknown: [],
  });
  await db.close();
});

test("a database that already has the Tokens table adopts the migrations with its data intact", async () => {
  const db = await openDb(tempDbPath());
  await db.exec(`
    CREATE TABLE Tokens (
      email TEXT NOT NULL PRIMARY KEY, token TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT (datetime('now')), updated_at TIMESTAMP DEFAULT (datetime('now')),
      smtp_password TEXT NOT NULL, app_id TEXT
    );
    INSERT INTO Tokens (email, token, smtp_password) VALUES ('Mixed@Example.org', '{}', 'pw');
  `);
  await runMigrations(db, MIGRATIONS);
  assert.deepEqual(
    await db.get(
      "SELECT email FROM Tokens WHERE email = ? COLLATE NOCASE",
      "mixed@example.org"
    ),
    { email: "Mixed@Example.org" }
  );
  await db.close();
});

test("refuses to migrate a database migrated by newer code, and undoes nothing", async () => {
  const db = await openDb(tempDbPath());
  await runMigrations(db, MIGRATIONS);
  await db.run(
    "INSERT INTO migrations (id, name, up, down) VALUES (99, 'future', '', 'DROP TABLE Tokens')"
  );
  await assert.rejects(runMigrations(db, MIGRATIONS), /Refusing to migrate/);
  assert.ok(
    await db.get("SELECT name FROM sqlite_master WHERE name = 'Tokens'")
  );
  await db.close();
});

test("the apps refuse to start on an unmigrated database", async () => {
  process.env.SQLITE_PATH = tempDbPath();
  const { getDb, endDb } = await import("../lib/db.js");
  await assert.rejects(getDb(), /npm run db:migrate/);
  await endDb();
});

test("db:migrate CLI backs up before migrating and reports status", () => {
  const file = tempDbPath();
  const env = { ...process.env, SQLITE_PATH: file };
  const script = path.join(process.cwd(), "build", "scripts", "db-migrate.js");
  const first = execFileSync("node", [script], { env, encoding: "utf8" });
  assert.match(first, /2 pending migration/);
  assert.match(first, /Applied 2 migration/);
  const backups = fs.readdirSync(path.join(path.dirname(file), "backups"));
  assert.equal(backups.length, 1);
  const second = execFileSync("node", [script], { env, encoding: "utf8" });
  assert.match(second, /0 pending migration/);
});

test("getUser and updateUserSmtpPassword match emails case-insensitively", async () => {
  process.env.SQLITE_PATH = tempDbPath();
  const migrated = await openDb(process.env.SQLITE_PATH);
  await runMigrations(migrated, MIGRATIONS);
  await migrated.close();
  const { getUser, updateUserSmtpPassword, upsert, endDb } =
    await import("../lib/db.js");
  try {
    await upsert("Tokens", [
      { email: "Skazy66@Example.org", token: "{}", smtp_password: "pw1" },
    ]);
    assert.equal(
      (await getUser("skazy66@example.org"))?.email,
      "Skazy66@Example.org"
    );
    assert.equal((await getUser("SKAZY66@EXAMPLE.ORG"))?.smtp_password, "pw1");
    await updateUserSmtpPassword("skazy66@example.org", "pw2");
    assert.equal((await getUser("Skazy66@Example.org"))?.smtp_password, "pw2");
    assert.equal(await getUser("someone-else@example.org"), undefined);
  } finally {
    await endDb();
  }
});
