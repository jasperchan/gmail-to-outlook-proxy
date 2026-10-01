"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Copy,
  Loader2,
  Server,
  Link,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { Header } from "../components/header";
import { Footer } from "../components/footer";
import Image from "next/image";

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{
    email: string;
    password: string;
    smtpPort: number;
    smtpServer: string;
    security: string;
  } | null>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch("/api/user", { cache: "no-store" });
        const data = await res.json();
        setConfig({
          email: data.email,
          password: data.smtp_password,
          smtpPort: 587,
          smtpServer: data.smtp_host,
          security: "TLS",
        });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load configuration"
        );
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const resetPassword = async () => {
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const data = await res.json();
      setConfig({
        email: data.email,
        password: data.smtp_password,
        smtpPort: 587,
        smtpServer: data.smtp_host,
        security: "TLS",
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load configuration"
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">
            Loading Configuration...
          </h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 flex items-center justify-center">
        <div className="flex flex-col items-center">
          <a
            className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-xl text-white bg-[#05a6f0] hover:bg-[#0490d3] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#05a6f0] transition-all duration-200 hover:scale-105"
            href="/auth"
          >
            <Image
              src="/microsoft.svg"
              alt="Microsoft Logo"
              className="h-5 w-5 mr-3"
              width={20}
              height={20}
            />
            Sign in with Microsoft
            <ArrowRight className="ml-3 h-5 w-5" />
          </a>
          <p className="mt-4 text-sm text-gray-500">
            Secure authentication through Microsoft's official{" "}
            <a
              className="text-blue-500"
              rel="noopener"
              target="_blank"
              href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow"
            >
              OAuth 2.0 flow
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Header />

        <div className="mt-16 bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-center space-x-3 mb-8">
            <Server className="h-8 w-8 text-green-500" />
            <h2 className="text-2xl font-semibold text-gray-900">
              Your SMTP Configuration
            </h2>
          </div>

          {config && (
            <div className="space-y-6">
              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 uppercase">
                      Server
                    </label>
                    <div className="mt-1 text-lg font-mono text-black">
                      {config.smtpServer}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(config.smtpServer)}
                    className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 uppercase">
                      Port
                    </label>
                    <div className="mt-1 text-lg font-mono text-black">
                      {config.smtpPort}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(String(config.smtpPort))}
                    className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 uppercase">
                      Username
                    </label>
                    <div className="mt-1 text-lg font-mono text-black">
                      {config.email}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(config.email)}
                    className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex items-center">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-500 uppercase">
                      Password
                    </label>
                    <div className="mt-1 text-lg font-mono text-black">
                      {config.password}
                    </div>
                  </div>
                  <div className="flex-none">
                    <button
                      onClick={() => resetPassword()}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      title="Copy to clipboard"
                    >
                      <RefreshCw className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="flex-none">
                    <button
                      onClick={() => copyToClipboard(config.password)}
                      className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                      title="Copy to clipboard"
                    >
                      <Copy className="h-5 w-5 text-gray-500" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center">
                  <div>
                    <label className="block text-sm font-medium text-gray-500 uppercase">
                      Security
                    </label>
                    <div className="mt-1 text-lg font-mono text-black">
                      {config.security}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(config.security)}
                    className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
                    title="Copy to clipboard"
                  >
                    <Copy className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 p-4 bg-blue-50 rounded-lg">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              Next Steps
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-blue-800">
              <li>
                Open{" "}
                <a
                  rel="noopener"
                  href="https://mail.google.com/mail/u/0/#settings/accounts"
                  target="_blank"
                >
                  Gmail Settings{" "}
                  <Link
                    className="inline align-text-bottom"
                    width={16}
                    style={{ bottom: -2, position: "relative" }}
                  />
                </a>
                .
              </li>
              <li>Go to "Accounts and Import".</li>
              <li>Find "Send mail as" section.</li>
              <li>Add your Outlook.com email using the SMTP settings above.</li>
            </ol>
          </div>
        </div>

        <div
          className="mt-12 pt-8 border-t border-gray-100"
          style={{ marginTop: 32 }}
        >
          <div className="flex flex-col items-center">
            <a
              className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-xl text-white bg-[#05a6f0] hover:bg-[#0490d3] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#05a6f0] transition-all duration-200 hover:scale-105"
              href="/signout"
            >
              Sign out
              <LogOut className="ml-3 h-5 w-5" />
            </a>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
}
