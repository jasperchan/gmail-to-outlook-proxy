import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AddressInfo } from "node:net";
import SMTPConnection from "nodemailer/lib/smtp-connection";
import { createSmtpServer } from "./server.js";
import { getHeaderAddresses, mergeCopies, rewriteRecipients } from "./merge.js";
import type { Fixture } from "./fixture.js";

// Replays recorded client behavior (smtp/fixtures, see `npm run smtp:fixture`) against
// the real SMTP server with Microsoft Graph replaced by a fake that captures what it
// would have sent. Graph delivers to the To/Cc/Bcc headers, so that's what we assert on.

type User = { email: string };

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadFixture(name: string): Fixture {
  return JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "smtp", "fixtures", `${name}.json`),
      "utf8"
    )
  );
}

async function startServer(
  options: {
    failSends?: number;
    mergeWindowMs?: number;
    sendDelayMs?: number;
  } = {}
) {
  const sent: { user: string; raw: Buffer }[] = [];
  const hooked: Buffer[] = [];
  let failures = options.failSends ?? 0;
  const { server, close, drain } = createSmtpServer<User>({
    // long enough that parallel test connections always land in the same window
    mergeWindowMs: options.mergeWindowMs ?? 1000,
    onSent: (_user, raw) => hooked.push(raw),
    serverOptions: {
      secure: false,
      disabledCommands: ["STARTTLS"],
      allowInsecureAuth: true,
      logger: false,
    },
    async authenticate(username, password) {
      if (password !== "pw") {
        throw new Error("bad password");
      }
      return { email: username };
    },
    async send(user, raw) {
      if (options.sendDelayMs) {
        await delay(options.sendDelayMs);
      }
      if (failures > 0) {
        failures--;
        throw new Error("Graph unavailable");
      }
      sent.push({ user: user.email, raw });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.server.address() as AddressInfo).port;
  return {
    sent,
    hooked,
    port,
    drain,
    async stop() {
      close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// one SMTP connection + transaction, like each of Gmail's per-recipient deliveries
function deliver(
  port: number,
  copy: { rcptTo: string[]; raw: string },
  user = "sender@example.com"
) {
  return new Promise<void>((resolve, reject) => {
    const connection = new SMTPConnection({
      port,
      host: "127.0.0.1",
      ignoreTLS: true,
      logger: false,
    } as any);
    connection.once("error", reject);
    connection.connect(() => {
      connection.login({ user, pass: "pw" } as any, (err) => {
        if (err) {
          return reject(err);
        }
        connection.send(
          { from: user, to: copy.rcptTo },
          Buffer.from(copy.raw),
          (err) => {
            connection.quit();
            err ? reject(err) : resolve();
          }
        );
      });
    });
  });
}

// the To copy and the Bcc copy race; the result must not depend on which wins
for (const order of ["to-first", "bcc-first"] as const) {
  test(`gmail To+Bcc (${order}): one send that names the Bcc recipient`, async () => {
    const fixture = loadFixture("gmail-to-bcc");
    const [toCopy, bccCopy] = fixture.copies;
    const [first, second] =
      order === "to-first" ? [toCopy, bccCopy] : [bccCopy, toCopy];
    const server = await startServer();
    try {
      await Promise.all([
        deliver(server.port, first),
        delay(30).then(() => deliver(server.port, second)),
      ]);
      assert.equal(server.sent.length, 1);
      const headers = getHeaderAddresses(server.sent[0].raw);
      assert.deepEqual(headers.to, ["to@example.org"]);
      assert.deepEqual(headers.bcc, ["bcc@example.org"]);
    } finally {
      await server.stop();
    }
  });
}

test("gmail To+Cc: parallel copies of one message are sent once", async () => {
  const fixture = loadFixture("gmail-to-cc-partial");
  const ccCopy = fixture.copies[0];
  // Gmail's To copy is the same message delivered to the To recipient
  const toCopy = { ...ccCopy, rcptTo: ["to@example.org"] };
  const server = await startServer();
  try {
    await Promise.all([
      deliver(server.port, toCopy),
      deliver(server.port, ccCopy),
    ]);
    assert.equal(server.sent.length, 1);
    const headers = getHeaderAddresses(server.sent[0].raw);
    assert.deepEqual(headers.to, ["to@example.org"]);
    assert.deepEqual(headers.cc, ["cc@example.org"]);
    assert.deepEqual(headers.bcc, []);
  } finally {
    await server.stop();
  }
});

test("standard client: one transaction with an envelope-only Bcc gets a Bcc header", async () => {
  const toCopy = loadFixture("gmail-to-bcc").copies[0];
  const server = await startServer();
  try {
    await deliver(server.port, {
      rcptTo: ["to@example.org", "bcc@example.org"],
      raw: toCopy.raw,
    });
    assert.equal(server.sent.length, 1);
    const headers = getHeaderAddresses(server.sent[0].raw);
    assert.deepEqual(headers.to, ["to@example.org"]);
    assert.deepEqual(headers.bcc, ["bcc@example.org"]);
  } finally {
    await server.stop();
  }
});

test("a failed send is reported to every connection and a retry still sends", async () => {
  const [toCopy, bccCopy] = loadFixture("gmail-to-bcc").copies;
  const server = await startServer({ failSends: 1 });
  try {
    const results = await Promise.allSettled([
      deliver(server.port, toCopy),
      deliver(server.port, bccCopy),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["rejected", "rejected"]
    );
    assert.equal(server.sent.length, 0);
    // the client retries; the failed attempt must not be treated as already sent
    await Promise.all([
      deliver(server.port, toCopy),
      deliver(server.port, bccCopy),
    ]);
    assert.equal(server.sent.length, 1);
    assert.deepEqual(getHeaderAddresses(server.sent[0].raw).bcc, [
      "bcc@example.org",
    ]);
  } finally {
    await server.stop();
  }
});

test("a copy arriving after the send only goes to recipients not yet delivered", async () => {
  const [toCopy, bccCopy] = loadFixture("gmail-to-bcc").copies;
  const server = await startServer({ mergeWindowMs: 50 });
  try {
    await deliver(server.port, toCopy);
    await delay(100);
    await deliver(server.port, bccCopy);
    assert.equal(server.sent.length, 2);
    const late = getHeaderAddresses(server.sent[1].raw);
    assert.deepEqual(late.to, []);
    assert.deepEqual(late.cc, []);
    assert.deepEqual(late.bcc, ["bcc@example.org"]);
    // and a straggler for an already delivered recipient is not resent
    await deliver(server.port, toCopy);
    assert.equal(server.sent.length, 2);
  } finally {
    await server.stop();
  }
});

test("the same Message-ID from different users is never merged", async () => {
  const toCopy = loadFixture("gmail-to-bcc").copies[0];
  const server = await startServer();
  try {
    await Promise.all([
      deliver(server.port, toCopy, "a@example.com"),
      deliver(server.port, toCopy, "b@example.com"),
    ]);
    assert.deepEqual(server.sent.map((s) => s.user).sort(), [
      "a@example.com",
      "b@example.com",
    ]);
  } finally {
    await server.stop();
  }
});

test("mergeCopies handles folded headers, groups and case", () => {
  const raw = Buffer.from(
    [
      "From: <sender@example.com>",
      "To: Team: A <A@Example.org>,",
      "\t b@example.org;",
      'Cc: "C, Person" <c@example.org>',
      "Message-ID: <x@example.com>",
      "",
      "body",
    ].join("\r\n")
  );
  const merged = mergeCopies([
    {
      rcptTo: [
        "a@example.org",
        "B@example.org",
        "c@example.org",
        "d@example.org",
      ],
      raw,
    },
  ]);
  const headers = getHeaderAddresses(merged.raw);
  assert.deepEqual(headers.to, ["a@example.org", "b@example.org"]);
  assert.deepEqual(headers.cc, ["c@example.org"]);
  assert.deepEqual(headers.bcc, ["d@example.org"]);
  assert.ok(merged.raw.toString().endsWith("\r\n\r\nbody"));
});

// a synthetic message built on the recorded Gmail headers
function withHeaders(raw: string, replace: Record<string, string | null>) {
  const [header, ...rest] = raw.split("\r\n\r\n");
  let lines = header.split("\r\n");
  for (const [name, value] of Object.entries(replace)) {
    lines = lines.filter(
      (l) => !l.toLowerCase().startsWith(name.toLowerCase() + ":")
    );
    if (value !== null) {
      lines.push(`${name}: ${value}`);
    }
  }
  return [lines.join("\r\n"), ...rest].join("\r\n\r\n");
}

test("gmail To+Cc+2 Bcc: four copies become one message naming both Bcc recipients", async () => {
  const base = withHeaders(loadFixture("gmail-to-bcc").copies[0].raw, {
    Cc: "cc@example.org",
    "Message-ID": "<mixed@example.com>",
  });
  const server = await startServer();
  try {
    await Promise.all([
      deliver(server.port, { rcptTo: ["to@example.org"], raw: base }),
      deliver(server.port, { rcptTo: ["cc@example.org"], raw: base }),
      deliver(server.port, {
        rcptTo: ["b1@example.org"],
        raw: withHeaders(base, { Bcc: "b1@example.org" }),
      }),
      deliver(server.port, {
        rcptTo: ["b2@example.org"],
        raw: withHeaders(base, { Bcc: "b2@example.org" }),
      }),
    ]);
    assert.equal(server.sent.length, 1);
    const headers = getHeaderAddresses(server.sent[0].raw);
    assert.deepEqual(headers.to, ["to@example.org"]);
    assert.deepEqual(headers.cc, ["cc@example.org"]);
    assert.deepEqual(headers.bcc.sort(), ["b1@example.org", "b2@example.org"]);
    assert.equal(server.hooked.length, 1);
  } finally {
    await server.stop();
  }
});

test("Bcc-only message (no To) is sent to the Bcc recipient", async () => {
  const raw = withHeaders(loadFixture("gmail-to-bcc").copies[1].raw, {
    To: null,
  });
  const server = await startServer({ mergeWindowMs: 50 });
  try {
    await deliver(server.port, { rcptTo: ["bcc@example.org"], raw });
    assert.equal(server.sent.length, 1);
    const headers = getHeaderAddresses(server.sent[0].raw);
    assert.deepEqual(headers.to, []);
    assert.deepEqual(headers.bcc, ["bcc@example.org"]);
  } finally {
    await server.stop();
  }
});

test("copies arriving while the merged send is in flight are not sent twice", async () => {
  const [toCopy, bccCopy] = loadFixture("gmail-to-bcc").copies;
  const server = await startServer({ mergeWindowMs: 50, sendDelayMs: 400 });
  try {
    const first = deliver(server.port, toCopy);
    await delay(150); // the To copy's group has flushed and its send is in flight
    await Promise.all([
      first,
      deliver(server.port, bccCopy),
      deliver(server.port, toCopy), // a retry/duplicate of the To copy
    ]);
    // the full message once, then the Bcc recipient alone
    assert.equal(server.sent.length, 2);
    assert.deepEqual(getHeaderAddresses(server.sent[0].raw).to, [
      "to@example.org",
    ]);
    const late = getHeaderAddresses(server.sent[1].raw);
    assert.deepEqual(late.to, []);
    assert.deepEqual(late.bcc, ["bcc@example.org"]);
  } finally {
    await server.stop();
  }
});

test("concurrent late copies are sent once each and remembered", async () => {
  const [toCopy, bccCopy] = loadFixture("gmail-to-bcc").copies;
  const bcc2 = {
    rcptTo: ["bcc2@example.org"],
    raw: withHeaders(bccCopy.raw, { Bcc: "bcc2@example.org" }),
  };
  const server = await startServer({ mergeWindowMs: 50, sendDelayMs: 100 });
  try {
    await deliver(server.port, toCopy);
    await Promise.all([
      deliver(server.port, bccCopy),
      deliver(server.port, bcc2),
    ]);
    await deliver(server.port, bccCopy);
    assert.equal(server.sent.length, 3);
    assert.deepEqual(
      server.sent
        .slice(1)
        .map((s) => getHeaderAddresses(s.raw).bcc[0])
        .sort(),
      ["bcc2@example.org", "bcc@example.org"]
    );
    assert.equal(server.hooked.length, 3);
  } finally {
    await server.stop();
  }
});

test("rewriteRecipients keeps the Bcc in the header of a body-less message", () => {
  for (const raw of [
    "From: a@x.org\r\nTo: b@x.org\r\nSubject: hi\r\n",
    "\r\nbody\r\n",
  ]) {
    const out = rewriteRecipients(Buffer.from(raw), ["c@x.org"]);
    assert.deepEqual(
      getHeaderAddresses(out).bcc,
      ["c@x.org"],
      JSON.stringify(out.toString())
    );
  }
});

test("a long Bcc list is folded under the 998 character line limit", () => {
  const recipients = Array.from(
    { length: 80 },
    (_, i) => `user${i}@example.org`
  );
  const merged = mergeCopies([
    {
      rcptTo: ["to@example.org", ...recipients],
      raw: Buffer.from("To: to@example.org\r\nMessage-ID: <m@x>\r\n\r\nbody"),
    },
  ]);
  assert.ok(
    merged.raw
      .toString()
      .split("\r\n")
      .every((line) => line.length <= 998)
  );
  assert.equal(getHeaderAddresses(merged.raw).bcc.length, 80);
});

test("a quoted local part in the envelope matches the header address", () => {
  const merged = mergeCopies([
    {
      rcptTo: ['"john.doe"@example.org'],
      raw: Buffer.from(
        'To: "john.doe"@example.org\r\nMessage-ID: <q@x>\r\n\r\nbody'
      ),
    },
  ]);
  assert.deepEqual(getHeaderAddresses(merged.raw).bcc, []);
});

test("drain: a fan-out in progress still merges, then the server stops listening", async () => {
  const [toCopy, bccCopy] = loadFixture("gmail-to-bcc").copies;
  const server = await startServer({ mergeWindowMs: 5000 });
  try {
    const first = deliver(server.port, toCopy);
    await delay(100);
    // SIGTERM arrives while the To copy is held waiting for siblings
    const drained = server.drain({ graceMs: 300, timeoutMs: 5000 });
    await Promise.all([first, deliver(server.port, bccCopy)]);
    assert.deepEqual(await drained, { leftover: 0 });
    // merged into one send, without waiting out the 5s merge window
    assert.equal(server.sent.length, 1);
    assert.deepEqual(getHeaderAddresses(server.sent[0].raw).bcc, [
      "bcc@example.org",
    ]);
    // and new connections are refused after the grace period
    await assert.rejects(deliver(server.port, toCopy));
  } finally {
    await server.stop().catch(() => {});
  }
});

test("drain waits for an in-flight Graph send before finishing", async () => {
  const toCopy = loadFixture("gmail-to-bcc").copies[0];
  const server = await startServer({ mergeWindowMs: 50, sendDelayMs: 600 });
  try {
    const delivered = deliver(server.port, toCopy);
    await delay(150); // group flushed, Graph send in progress
    const started = Date.now();
    const result = await server.drain({ graceMs: 0, timeoutMs: 5000 });
    await delivered; // the client got its 250
    assert.deepEqual(result, { leftover: 0 });
    assert.equal(server.sent.length, 1);
    assert.ok(
      Date.now() - started >= 400,
      "drain returned before the send finished"
    );
  } finally {
    await server.stop().catch(() => {});
  }
});
