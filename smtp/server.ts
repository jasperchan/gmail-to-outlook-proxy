import Server, { SMTPServerOptions, SMTPServerSession } from "smtp-server";
import Cache from "node-cache";
import {
  Copy,
  getHeaderAddresses,
  getMessageId,
  mergeCopies,
} from "./merge.js";

type SmtpServerDeps<U extends { email: string }> = {
  // resolves the session user or throws for bad credentials
  authenticate(username: string, password: string): Promise<U>;
  // forwards a MIME message; recipients are taken from its To/Cc/Bcc headers
  send(user: U, raw: Buffer): Promise<void>;
  onSent?(user: U, raw: Buffer): void;
  // how long to wait for more copies of the same message (Gmail sends one per recipient)
  mergeWindowMs?: number;
  maxWaitMs?: number;
  serverOptions?: SMTPServerOptions;
};

type Waiter = (err?: Error | null) => void;

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
  const pending = new Map<string, Group<U>>();
  // merged sends still waiting on Graph; resolves true once delivered
  const inflight = new Map<string, Promise<boolean>>();
  // messages already sent, to recognise copies arriving later
  const delivered = new Cache({ stdTTL: 600, checkperiod: 120 });
  // connections currently receiving DATA (not yet routed)
  let receiving = 0;
  // set while shutting down: groups are sent immediately instead of waiting for siblings
  let flushNow = false;
  let draining: Promise<{ leftover: number }> | undefined;

  function flush(key: string) {
    const group = pending.get(key);
    if (!group) {
      return;
    }
    pending.delete(key);
    clearTimeout(group.timer);
    const sending = (async () => {
      try {
        const merged = await mergeCopies(group.copies);
        await deps.send(group.user, merged);
        // before resolving, so copies waiting on this send see who already has it
        delivered.set(key, true);
        group.waiters.forEach((waiter) => waiter());
        deps.onSent?.(group.user, merged);
        return true;
      } catch (err: any) {
        // nothing was acknowledged yet, so the client sees the failure and can retry
        group.waiters.forEach((waiter) => waiter(err));
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

  // A copy of a message that was already sent: acknowledge it without sending again.
  // Graph delivers to the message's headers, so a Bcc recipient whose copy arrives
  // after the merge window can't be added without re-sending to everyone.
  async function skipDuplicate(waiter: Waiter, copy: Copy) {
    if ((await getHeaderAddresses(copy.raw)).bcc.length) {
      console.warn(
        "Bcc copy arrived after its message was sent; that recipient was not delivered"
      );
    }
    waiter();
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
      // wait for the send so this copy is neither sent twice nor lost on failure
      sending.then((ok) =>
        ok
          ? skipDuplicate(waiter, copy)
          : route(key, user, waiter, copy, grouped)
      );
      return;
    }
    if (delivered.has(key)) {
      return skipDuplicate(waiter, copy);
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

  async function accept(
    session: SMTPServerSession,
    raw: Buffer,
    callback: Waiter
  ) {
    const user = session.user as any as U;
    const copy = {
      rcptTo: session.envelope.rcptTo.map((r) => r.address),
      raw,
    };
    const messageId = await getMessageId(raw).catch(() => undefined);
    // scope by sender so different users' messages can never be merged
    const key = messageId
      ? `${user.email.toLowerCase()}\n${messageId}`
      : `${user.email.toLowerCase()}\n${session.id}:${
          (session as any).transaction
        }`;
    route(key, user, callback, copy, !!messageId);
  }

  const server = new Server.SMTPServer({
    authMethods: ["PLAIN", "LOGIN"],
    ...deps.serverOptions,
    async onAuth(auth, _session, callback) {
      try {
        const user = await deps.authenticate(
          auth.username ?? "",
          auth.password ?? ""
        );
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
          accept(session, Buffer.concat(chunks), callback).catch(callback);
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
    return pending.size + inflight.size + receiving;
  }

  // Graceful shutdown: keep accepting for a grace period so a fan-out already in
  // progress (Gmail's per-recipient connections) can complete its group, then stop
  // listening, send everything held immediately and wait for in-flight sends and
  // open DATA transfers to finish (bounded by timeoutMs).
  // the 30s default cap must stay below pm2's kill_timeout and compose's stop_grace_period
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
          Promise.allSettled([...inflight.values()]),
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
