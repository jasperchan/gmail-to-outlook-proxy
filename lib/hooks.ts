import fs from "node:fs";
import path from "node:path";

export type SendError = {
  // what the SMTP client was told: 550 bounces now, 451 makes Gmail retry
  responseCode: number;
  // Graph's HTTP status, error code (e.g. ErrorSendAsDenied) and request-id, when Graph answered
  status?: number;
  code?: string;
  message: string;
  requestId?: string;
};

type Hooks = {
  onNewLogin?: (email: string) => Promise<void> | void;
  onMailForwarded?: (email: string, msg: string) => Promise<void> | void;
  onMailFailed?: (
    error: SendError,
    email: string,
    msg: string
  ) => Promise<void> | void;
};

// Implement your own logic in a gitignored hooks.local.js at the project root, e.g.
//   module.exports = {
//     async onNewLogin(email) { ... },
//     async onMailForwarded(email, msg) { ... },
//     async onMailFailed(error, email, msg) { ... },
//   };
// msg is the base64 MIME message as sent to Graph (or as received, if merging failed).
let hooks: Hooks | undefined;
function getHooks(): Hooks {
  if (!hooks) {
    const file = path.join(process.cwd(), "hooks.local.js");
    // bypass the bundler so the file is resolved at runtime
    hooks = fs.existsSync(file) ? eval("require")(file) : {};
  }
  return hooks!;
}

// hooks must never break login or sending
async function run<K extends keyof Hooks>(
  name: K,
  ...args: Parameters<NonNullable<Hooks[K]>>
) {
  try {
    await (getHooks()[name] as any)?.(...args);
  } catch (err: any) {
    console.error(`Hook ${name} failed:`, err?.message ?? err);
  }
}

export async function onNewLogin(email: string) {
  await run("onNewLogin", email);
}

export async function onMailForwarded(email: string, msg: string) {
  await run("onMailForwarded", email, msg);
}

export async function onMailFailed(
  error: SendError,
  email: string,
  msg: string
) {
  await run("onMailFailed", error, email, msg);
}
