import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: `Configure "Send mail as" In Gmail For Outlook.com And Microsoft 365 Emails`,
  applicationName: "Gmail to Outlook.com SMTP Proxy",
  description: `An SMTP relay service to restore Gmail's "Send mail as" functionality
        for your Outlook.com or Microsoft 365 work or school account after
        Microsoft's basic authentication
        deprecation on September 16, 2024.`,
};

export const viewport: Viewport = {
  initialScale: 0.5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <GoogleAnalytics gaId="G-F7HYD7SP2S" />
      </body>
    </html>
  );
}
