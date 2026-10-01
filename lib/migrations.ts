import path from "node:path";
import fs from "node:fs";
import { Database } from "sqlite";

// Schema migrations are numbered SQL files in migrations/ (`-- Up` / `-- Down`),
// applied explicitly with `npm run db:migrate` (see README "Database migrations").
// The apps never migrate on their own: getDb() refuses to run on a stale schema.

const TABLE = "migrations";

export function migrationsPath() {
  return process.env.MIGRATIONS_PATH || path.join(process.cwd(), "migrations");
}

function migrationFiles(dir = migrationsPath()) {
  return fs
    .readdirSync(dir)
    .map((file) => /^(\d+)[.-](.*?)\.sql$/.exec(file))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ id: Number(match[1]), name: match[2] }))
    .sort((a, b) => a.id - b.id);
}

async function appliedIds(db: Database) {
  const exists = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    TABLE
  );
  if (!exists) {
    return [];
  }
  const rows = await db.all<{ id: number }[]>(
    `SELECT id FROM "${TABLE}" ORDER BY id`
  );
  return rows.map((row) => row.id);
}

export async function migrationStatus(db: Database, dir = migrationsPath()) {
  const files = migrationFiles(dir);
  const known = new Set(files.map((f) => f.id));
  const applied = await appliedIds(db);
  const appliedSet = new Set(applied);
  return {
    pending: files.filter((f) => !appliedSet.has(f.id)),
    // applied by newer code: this checkout doesn't have their files
    unknown: applied.filter((id) => !known.has(id)),
  };
}

export async function assertMigrated(db: Database, dir = migrationsPath()) {
  const { pending, unknown } = await migrationStatus(db, dir);
  if (unknown.length) {
    throw new Error(
      `Database has migrations this code doesn't know (${unknown.join(
        ", "
      )}); it was migrated by a newer version.`
    );
  }
  if (pending.length) {
    throw new Error(
      `Database schema is out of date: ${
        pending.length
      } pending migration(s) (${pending
        .map((m) => `${m.id}-${m.name}`)
        .join(", ")}). Run \`npm run db:migrate\`.`
    );
  }
}

// Applies pending migrations, each in its own transaction (sqlite's migrate()).
// Refuses when the database has migrations this code doesn't know: sqlite's
// migrate() would otherwise run their `down` scripts and could drop data.
export async function runMigrations(db: Database, dir = migrationsPath()) {
  const { pending, unknown } = await migrationStatus(db, dir);
  if (unknown.length) {
    throw new Error(
      `Refusing to migrate: the database has migrations ${unknown.join(
        ", "
      )} that this code doesn't have. Run db:migrate from the newer version.`
    );
  }
  if (pending.length) {
    await db.migrate({ migrationsPath: dir, table: TABLE });
  }
  return pending;
}
