import fs from "node:fs";
import path from "node:path";

type Hooks = {
  onNewLogin?: (email: string) => Promise<void> | void;
  onMailForwarded?: (email: string, msg: string) => Promise<void> | void;
};

// Implement your own logic in a gitignored hooks.local.js at the project root, e.g.
//   module.exports = { async onNewLogin(email) { ... }, async onMailForwarded(email, msg) { ... } };
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
async function run(name: keyof Hooks, ...args: [string, string?]) {
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
