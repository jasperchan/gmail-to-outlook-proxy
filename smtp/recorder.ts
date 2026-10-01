import fs from "node:fs";
import path from "node:path";
import type { SMTPServerSession } from "smtp-server";

// SMTP_RECORD_DIR=<dir> saves every transaction (envelope + raw message) so client
// behavior (e.g. how Gmail splits recipients) can be replayed as test fixtures.
// Recordings contain real message content: keep the dir out of git (data/ is ignored).
const recordDir = process.env.SMTP_RECORD_DIR;

export type RecordOutcome = "sent" | "late-sent" | "duplicate" | "error";

export function record(
  session: SMTPServerSession,
  raw: Buffer,
  outcome: RecordOutcome,
  error?: string
) {
  if (!recordDir) {
    return;
  }
  try {
    // owner-only: recordings hold full messages and Bcc lists
    fs.mkdirSync(recordDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(recordDir, 0o700);
    const receivedAt = new Date().toISOString();
    const base = `${receivedAt.replace(/[:.]/g, "-")}-${session.id}-${
      (session as any).transaction
    }`;
    fs.writeFileSync(path.join(recordDir, `${base}.eml`), raw, { mode: 0o600 });
    fs.writeFileSync(
      path.join(recordDir, `${base}.json`),
      JSON.stringify(
        {
          receivedAt,
          sessionId: session.id,
          transaction: (session as any).transaction,
          remoteAddress: session.remoteAddress,
          clientHostname: session.clientHostname,
          hostNameAppearsAs: session.hostNameAppearsAs,
          secure: session.secure,
          user: (session.user as any)?.user?.email,
          mailFrom: session.envelope.mailFrom
            ? session.envelope.mailFrom.address
            : null,
          rcptTo: session.envelope.rcptTo.map((r) => r.address),
          outcome,
          error,
          eml: `${base}.eml`,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (err: any) {
    console.error("Recording failed:", err?.message ?? err);
  }
}
