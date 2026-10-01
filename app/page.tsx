import { ArrowRight, AlertCircle, Server, Github } from "lucide-react";
import { Header } from "./components/header";
import { Footer } from "./components/footer";
import Image from "next/image";

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Header />

        <div className="mt-16 bg-white rounded-2xl shadow-xl p-8">
          <div className="flex items-start space-x-4">
            <AlertCircle className="h-6 w-6 text-amber-500 flex-shrink-0 mt-1" />
            <div className="pr-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                The Issue
              </h2>
              <p className="text-gray-600 leading-relaxed">
                As of September 16, 2024, Microsoft has{" "}
                <a
                  className="text-blue-500"
                  rel="noopener"
                  target="_blank"
                  href="https://techcommunity.microsoft.com/blog/outlook/keeping-our-outlook-personal-email-users-safe-reinforcing-our-commitment-to-secu/4164184"
                >
                  discontinued
                </a>{" "}
                basic authentication for personal Outlook.com accounts. This
                change affects Gmail's "Send mail as" feature, which relies on
                basic SMTP authentication. Since Gmail hasn't updated their SMTP
                integration, users can no longer send emails through Outlook.com
                accounts via Gmail. Notably, attempts to connect to the
                Outlook.com SMTP server <code>smtp-mail.outlook.com</code>{" "}
                results in the following error:
              </p>
              <p className="text-red-600 leading-relaxed">
                <code>
                  Authentication failed. Please check your username/password.
                  Server returned error: "334 VXNlcm5hbWU6 334 UGFzc3dvcmQ6 535
                  5.7.139 Authentication unsuccessful, basic authentication is
                  disabled. [AS4P251CA0014.EURP251.PROD.OUTLOOK.COM
                  2024-10-26T21:19:04.955Z 08DCF55F2D078725] , code: 535"
                </code>
              </p>
            </div>
          </div>

          <div className="mt-12 flex items-start space-x-4">
            <Server className="h-6 w-6 text-green-500 flex-shrink-0 mt-1" />
            <div className="pr-10">
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">
                The Solution
              </h2>
              <p className="text-gray-600 leading-relaxed">
                <a
                  rel="noopener"
                  className="inline-flex gap-1 items-center px-4 py-2 border border-transparent text-lg font-medium rounded-xl text-white bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black transition-all duration-200 hover:scale-105"
                  href="https://github.com/jasperchan/gmail-to-outlook-proxy"
                  target="_blank"
                >
                  <Github fill="white" size={16} />
                  Github (For Self-Hosting)
                </a>
              </p>
              <p className="text-gray-600 leading-relaxed mt-4">
                This is a secure bridging service that enables Gmail to
                communicate seamlessly with Microsoft's modern authentication
                systems. It functions as an SMTP proxy that:
              </p>
              <ul className="text-gray-600 leading-relaxed list-disc pl-6">
                <li>
                  Accepts incoming email traffic from Gmail using a compatible
                  SMTP server
                </li>
                <li>
                  Securely handles the authentication and transmission process
                  using TLS encryption
                </li>
                <li>
                  Forwards your emails through Microsoft's Graph API using their{" "}
                  <a
                    className="text-blue-500"
                    rel="noopener"
                    target="_blank"
                    href="https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0&tabs=http#example-4-send-a-new-message-using-mime-format"
                  >
                    sendMail
                  </a>{" "}
                  endpoint
                </li>
                <li>
                  Works with personal Microsoft accounts (Outlook.com, Hotmail,
                  Live) and Microsoft 365 work or school accounts with an
                  Exchange Online mailbox (some organizations require an admin
                  to approve the app first)
                </li>
              </ul>
              <p className="text-gray-600 leading-relaxed">
                The service maintains end-to-end security by using encrypted
                HTTPS for Microsoft communications and TLS for Gmail
                connections. This ensures your email content remains protected
                and tamper-proof throughout transmission, while adhering to both
                Gmail's and Microsoft's security protocols. This is provided as
                a <strong>free</strong> service for personal use and the author
                strongly encourages self-hosting if this functionality is
                critical to you.
              </p>
              <p className="text-black bg-gray-200 p-4 mt-4">
                The <strong>only</strong> permission this service requests is{" "}
                <code>Mail.Send</code>, which is required to send emails on your
                behalf. Your email credentials are <strong>never</strong> stored
                or logged and no access is granted to your contacts or inbox.
                Revoke this limited permission at any time via{" "}
                <a
                  className="text-blue-500"
                  rel="noopener"
                  href="https://account.microsoft.com/privacy/app-access"
                  target="_blank"
                >
                  https://account.microsoft.com/privacy/app-access
                </a>{" "}
                (work or school accounts:{" "}
                <a
                  className="text-blue-500"
                  rel="noopener"
                  href="https://myapps.microsoft.com"
                  target="_blank"
                >
                  https://myapps.microsoft.com
                </a>
                ).
              </p>
            </div>
          </div>

          <div className="mt-8 pt-8 border-t border-gray-100">
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
        </div>
      </div>
      <Footer />
    </div>
  );
}
