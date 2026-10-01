import sqlite3 from "sqlite3";
import { Database, open } from "sqlite";
import _ from "lodash";
import { MicrosoftOAuthCredentials } from "./microsoft";
import { assertMigrated } from "./migrations";

export type Connection = Database;

let db: Promise<Connection> | undefined;

export type User = {
  email: string;
  token: MicrosoftOAuthCredentials;
  smtp_password: string;
  app_id: string | null;
};

export function getDb() {
  // memoize the promise so concurrent callers share one connection
  db ??= (async () => {
    const connection = await open({
      filename: process.env.SQLITE_PATH!,
      driver: sqlite3.Database,
    });
    try {
      // migrations are applied explicitly (npm run db:migrate), never on startup
      await assertMigrated(connection);
    } catch (err) {
      await connection.close();
      db = undefined; // allow a retry once the schema is migrated
      throw err;
    }
    return connection;
  })();
  return db;
}

export async function endDb() {
  if (db) {
    const connection = db;
    db = undefined;
    await (await connection.catch(() => undefined))?.close();
  }
}

export async function getUser(email?: string): Promise<User | undefined> {
  const db = await getDb();
  const result = await db.get<{
    email: string;
    token: string;
    smtp_password: string;
    app_id: string;
  }>(`SELECT * FROM Tokens WHERE email = ? COLLATE NOCASE`, email);
  return result
    ? {
        email: result.email,
        token: JSON.parse(result.token),
        smtp_password: result.smtp_password,
        app_id: result.app_id,
      }
    : undefined;
}

export async function updateUserSmtpPassword(
  email: string,
  smtp_password: string
) {
  const db = await getDb();
  await db.run(
    `UPDATE Tokens SET smtp_password = ? WHERE email = ? COLLATE NOCASE`,
    smtp_password,
    email
  );
  return await getUser(email);
}

export async function upsert<T extends { [f: string]: any }>(
  table: string,
  arr: Array<T>,
  options?: {
    ignoreIfSetFields?: Array<keyof T>;
  }
) {
  if (!arr.length) {
    return;
  }

  const db = await getDb();
  const fields = _.keys(_.first(arr));
  const ignoreIfSetFields = new Set(options?.ignoreIfSetFields);

  for (const row of arr) {
    const placeholders = fields.map(() => "?").join(",");
    const updateClauses = fields
      .filter((f) => !ignoreIfSetFields.has(f as keyof T))
      .map((f) => `${f} = excluded.${f}`)
      .join(",");
    const query = `
      INSERT INTO ${table} (${fields.join(",")})
      VALUES (${placeholders})
      ON CONFLICT DO UPDATE SET
      ${updateClauses}
    `;
    await db.run(
      query,
      _.map(fields, (f) => row[f])
    );
  }
}
