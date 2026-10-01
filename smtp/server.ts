import Server, { SMTPServerOptions, SMTPServerSession } from "smtp-server";
import Cache from "node-cache";
import {
  canonical,
  Copy,
  envelopeRecipients,
  getHeaderAddresses,
  getMessageId,
  mergeCopies,
  rewriteRecipients,
} from "./merge.js";
import { record } from "./recorder.js";

export type SmtpServerDeps<U extends { email: string }> = {
  // resolves the session user or throws for bad credentials
  authenticate(username: string, password: string): Promise<U>;
  // forwards a MIME message; recipients are taken from its To/Cc/Bcc headers
  send(user: U, raw: Buffer): Promise<void>;
  onSent?(user: U, raw: Buffer): void;
  log?(session: { id: string }, message: string): void;
  // how long to wait for more copies of the same message (Gmail sends one per recipient)
  mergeWindowMs?: number;
  maxWaitMs?: number;
  serverOptions?: SMTPServerOptions;
};

type Waiter = {
  session: SMTPServerSession;
  raw: Buffer;
  callback: (err?: Error | null) => void;
};

type Group<U> = {
  user: U;
  copies: Copy[];
  waiters: Waiter[];
  timer?: NodeJS.Timeout;
  deadline: number;
};

export function createSmtpServer<U extends { email: string }>(
  deps: SmtpServerDeps<U>
) {
  const mergeWindowMs = deps.mergeWindowMs ?? 5000;
  const maxWaitMs = deps.maxWaitMs ?? 60000;
  const log = deps.log ?? (() => {});
  const pending = new Map<string, Group<U>>();
  // merged sends still waiting on Graph; resolves true once delivered
  const inflight = new Map<string, Promise<boolean>>();
  // late copies for a message are handled one at a time
  const lateChains = new Map<string, Promise<void>>();
  // canonical recipients already delivered per message, for copies arriving after the send
  const delivered = new Cache({ stdTTL: 600, checkperiod: 120 });
  // connections currently receiving DATA (not yet routed)
  let receiving = 0;
  // set while shutting down: groups are sent immediately instead of waiting for siblings
  let flushNow = false;
  let draining: Promise<DrainResult> | undefined;

  function markDelivered(key: string, recipients: string[]) {
    delivered.set(key, [
      ...new Set([...(delivered.get<string[]>(key) ?? []), ...recipients]),
    ]);
  }

  function flush(key: string) {
    const group = pending.get(key);
    if (!group) {
      return;
    }
    pending.delete(key);
    clearTimeout(group.timer);
    const sending = (async () => {
      try {
        const merged = mergeCopies(group.copies);
        await deps.send(group.user, merged.raw);
        // before resolving, so copies waiting on this send see who already has it
        markDelivered(key, merged.recipients);
        for (const waiter of group.waiters) {
          record(waiter.session, waiter.raw, "sent");
          waiter.callback();
        }
        log(
          group.waiters[0].session,
          `sent ${group.copies.length} cop${
            group.copies.length === 1 ? "y" : "ies"
          } as one message to ${merged.recipients.join(", ")}`
        );
        deps.onSent?.(group.user, merged.raw);
        return true;
      } catch (err: any) {
        // nothing was acknowledged yet, so the client sees the failure and can retry
        for (const waiter of group.waiters) {
          record(
            waiter.session,
            waiter.raw,
            "error",
            err?.message ?? String(err)
          );
          waiter.callback(err);
        }
        return false;
      }
    })();
    inflight.set(key, sending);
    sending.finally(() => {
      if (inflight.get(key) === sending) {
        inflight.delete(key);
      }
    });
  }

  async function sendLate(key: string, user: U, waiter: Waiter, copy: Copy) {
    const already = new Set(delivered.get<string[]>(key) ?? []);
    const candidates = new Map<string, string>();
    for (const address of [
      ...envelopeRecipients([copy]),
      ...getHeaderAddresses(copy.raw).bcc,
    ]) {
      if (!candidates.has(canonical(address))) {
        candidates.set(canonical(address), address);
      }
    }
    const missing = [...candidates].filter(([key]) => !already.has(key));
    if (!missing.length) {
      log(waiter.session, "copy already delivered, skipped");
      record(waiter.session, waiter.raw, "duplicate");
      return waiter.callback();
    }
    // the message already went to its To/Cc recipients, so only address the new ones
    const raw = rewriteRecipients(
      copy.raw,
      missing.map(([, address]) => address),
      { dropToCc: true }
    );
    try {
      await deps.send(user, raw);
      markDelivered(
        key,
        missing.map(([canonicalAddress]) => canonicalAddress)
      );
      log(
        waiter.session,
        `late copy sent to ${missing.map(([, a]) => a).join(", ")}`
      );
      record(waiter.session, waiter.raw, "late-sent");
      waiter.callback();
      deps.onSent?.(user, raw);
    } catch (err: any) {
      record(waiter.session, waiter.raw, "error", err?.message ?? String(err));
      waiter.callback(err);
    }
  }

  function queueLate(key: string, user: U, waiter: Waiter, copy: Copy) {
    const next = (lateChains.get(key) ?? Promise.resolve()).then(() =>
      sendLate(key, user, waiter, copy)
    );
    lateChains.set(key, next);
    next.finally(() => {
      if (lateChains.get(key) === next) {
        lateChains.delete(key);
      }
    });
  }

  function route(
    key: string,
    user: U,
    waiter: Waiter,
    copy: Copy,
    grouped: boolean
  ) {
    const sending = inflight.get(key);
    if (sending) {
      // wait for the send so this copy neither duplicates it nor gets lost
      sending.then((ok) =>
        ok
          ? queueLate(key, user, waiter, copy)
          : route(key, user, waiter, copy, grouped)
      );
      return;
    }
    if (delivered.has(key)) {
      return queueLate(key, user, waiter, copy);
    }
    let group = pending.get(key);
    if (!group) {
      group = {
        user,
        copies: [],
        waiters: [],
        deadline: Date.now() + maxWaitMs,
      };
      pending.set(key, group);
    }
    group.copies.push(copy);
    group.waiters.push(waiter);
    clearTimeout(group.timer);
    const wait =
      grouped && !flushNow
        ? Math.max(0, Math.min(mergeWindowMs, group.deadline - Date.now()))
        : 0;
    group.timer = setTimeout(() => flush(key), wait);
  }

  function accept(
    session: SMTPServerSession,
    raw: Buffer,
    callback: Waiter["callback"]
  ) {
    const user = session.user as any as U;
    const waiter = { session, raw, callback };
    const copy = {
      rcptTo: session.envelope.rcptTo.map((r) => r.address),
      raw,
    };
    const messageId = getMessageId(raw);
    // scope by sender so different users' messages can never be merged
    const key = messageId
      ? `${user.email.toLowerCase()}\n${messageId}`
      : `${user.email.toLowerCase()}\n${session.id}:${
          (session as any).transaction
        }`;
    log(
      session,
      `transaction ${(session as any).transaction}: MAIL FROM ${
        session.envelope.mailFrom ? session.envelope.mailFrom.address : ""
      } RCPT TO ${copy.rcptTo.join(", ")}`
    );
    route(key, user, waiter, copy, !!messageId);
  }

  const server = new Server.SMTPServer({
    authMethods: ["PLAIN", "LOGIN"],
    ...deps.serverOptions,
    onConnect(session, callback) {
      log(
        session,
        `connect from ${session.remoteAddress} (${session.clientHostname})`
      );
      callback();
    },
    async onAuth(auth, session, callback) {
      try {
        const user = await deps.authenticate(
          auth.username ?? "",
          auth.password ?? ""
        );
        log(session, `auth ok for ${user.email} via ${auth.method}`);
        callback(null, { user: user as any });
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
      receiving++;
      stream
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .on("error", (err) => {
          receiving--;
          callback(err);
        })
        .on("end", () => {
          receiving--;
          accept(session, Buffer.concat(chunks), callback);
        });
    },
  });
  server.on("error", (err) => {
    // prevent unhandled error from crashing the server
    console.log(err);
  });

  function close() {
    pending.forEach((group) => clearTimeout(group.timer));
    delivered.close();
  }

  function busy() {
    return pending.size + inflight.size + lateChains.size + receiving;
  }

  // Graceful shutdown: keep accepting for a grace period so a fan-out already in
  // progress (Gmail's per-recipient connections) can complete its group, then stop
  // listening, send everything held immediately and wait for in-flight sends, late
  // copies and open DATA transfers to finish (bounded by timeoutMs).
  function drain(options: { graceMs?: number; timeoutMs?: number } = {}) {
    draining ??= (async () => {
      const deadline = Date.now() + (options.timeoutMs ?? 30000);
      await delay(options.graceMs ?? mergeWindowMs);
      const closed = new Promise<void>((resolve) =>
        server.close(() => resolve())
      );
      flushNow = true;
      [...pending.keys()].forEach(flush);
      while (busy() && Date.now() < deadline) {
        await Promise.race([
          Promise.allSettled([...inflight.values(), ...lateChains.values()]),
          delay(100),
        ]);
        [...pending.keys()].forEach(flush);
      }
      await Promise.race([closed, delay(Math.max(0, deadline - Date.now()))]);
      const leftover = busy();
      close();
      return { leftover };
    })();
    return draining;
  }

  return { server, close, drain };
}

export type DrainResult = { leftover: number };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
