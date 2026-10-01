import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import {
  exchangeForCredentials,
  getApp,
  getAuthorizationUrl,
} from "../../lib/microsoft";
import qs from "node:querystring";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { SessionData } from "../../lib/state";
import { onNewLogin } from "../../lib/hooks";

function getCallbackUrl(req: NextRequest) {
  const host = req.headers.get("host") ?? "localhost";
  const protocol = host.includes("localhost") ? "http" : "https";
  const callbackUrl = new URL("/auth", `${protocol}://${host}`).toString();
  return callbackUrl;
}

// /auth?app=<id or name> selects a non-default app registration (e.g. a work tenant)
export async function GET(req: NextRequest) {
  let app;
  try {
    app = getApp(req.nextUrl.searchParams.get("app"));
  } catch (err: any) {
    console.error("Unknown app requested:", err?.message ?? err);
    return NextResponse.redirect(new URL("/", req.url));
  }
  const redirectUrl = getAuthorizationUrl(getCallbackUrl(req), app);
  return NextResponse.redirect(redirectUrl);
}

function getStateApp(state?: string) {
  try {
    return JSON.parse(state ?? "{}").app as string | undefined;
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest) {
  let success = false;
  try {
    const session = await getIronSession<SessionData>(await cookies(), {
      password: process.env.SESSION_SECRET!,
      cookieName: process.env.SESSION_COOKIE!,
    });
    const body = qs.parse(await req.text()) as {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    };
    if (body.error) {
      throw new Error(`${body.error}: ${body.error_description}`);
    }
    const { email } = await exchangeForCredentials(
      getCallbackUrl(req),
      body.code!,
      getApp(getStateApp(body.state))
    );
    session.email = email;
    await session.save();
    await onNewLogin(email);
    success = true;
  } catch (err: any) {
    console.error("Login failed:", err?.error ?? err?.message ?? err);
  }
  // it's crazy but for some reason redirects are treated as errors!
  // https://nextjs.org/docs/app/building-your-application/routing/redirecting#redirects-in-nextconfigjs
  return redirect(success ? "/configuration" : "/");
}
