import { updateUserSmtpPassword } from "../../../lib/db";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSessionUser } from "../shared";

export async function POST() {
  const user = await getSessionUser();
  const updatedUser = await updateUserSmtpPassword(
    user.email,
    crypto.randomBytes(16).toString("hex")
  );
  // same shape as /api/user (don't send the OAuth token to the browser)
  return NextResponse.json({
    email: updatedUser!.email,
    smtp_password: updatedUser!.smtp_password,
    smtp_host: process.env.SMTP_HOST,
  });
}
