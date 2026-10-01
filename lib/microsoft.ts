import qs from "node:querystring";
import { Client } from "@microsoft/microsoft-graph-client";
import rp from "request-promise-native";
import { getUser, upsert } from "./db";
import crypto from "node:crypto";
import { throatNamespace } from "./throat";
import _ from "lodash";

type MicrosoftAppRegistration = {
  id: string;
  secret: string;
  // optional alias so /auth?app=<name> can select this app
  name?: string;
  // "consumers" (personal accounts, default), "organizations", "common", or a tenant id / domain
  tenant?: string;
};

export type MicrosoftOAuthCredentials = {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token: string;
  expires: number;
  // only returned for interactive logins (openid scope), never stored
  id_token?: string;
};

// https://learn.microsoft.com/en-us/graph/auth-v2-user?tabs=curl
// https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/quickStartType~/null/sourceType/Microsoft_AAD_IAM/appId/770fcbe8-e94c-41ed-a7c9-9f05d41aca9d/objectId/6ec2e516-d2bb-4e4d-af38-99cf6f90b6f0/isMSAApp~/false/defaultBlade/Overview/appSignInAudience/PersonalMicrosoftAccount
// support multiple app registrations
const appsArray: MicrosoftAppRegistration[] = JSON.parse(
  process.env.MICROSOFT_APPS!
);
const apps = _.keyBy(appsArray, "id");
const scopes = ["https://graph.microsoft.com/.default", "offline_access"];
// openid only for interactive logins: the id token's tid identifies personal vs work accounts
const loginScopes = [...scopes, "openid"];
// tenant id that every personal Microsoft account token carries
const personalAccountTenantId = "9188040d-6c67-4c5b-b112-36a304b66dad";
const clientDefaultId =
  process.env.MICROSOFT_APPS_DEFAULT_ID || appsArray[0].id;

// legacy rows have a null app_id, which falls back to the default app
export function getApp(idOrName?: string | null) {
  const key = idOrName || clientDefaultId;
  const app = apps[key] ?? _.find(appsArray, { name: key });
  if (!app) {
    throw new Error(`No client found for ${key}.`);
  }
  return app;
}

function getTenant(app: MicrosoftAppRegistration) {
  return app.tenant ?? "consumers";
}

export const getCredentials = throatNamespace(
  1,
  async (email: string, app: MicrosoftAppRegistration) => {
    const user = await getUser(email);
    const token = user?.token;
    if (!token) {
      throw new Error(`No token found for ${email}.`);
    }
    const credentials: MicrosoftOAuthCredentials = token;
    // refresh if expired or expiring within 5 minutes
    if (credentials.expires < Date.now() + 5 * 60 * 1000) {
      return refreshCredentials(email, credentials, app);
    }
    return credentials;
  }
);

export function getAuthorizationUrl(
  redirectUrl: string,
  app: MicrosoftAppRegistration
) {
  return `https://login.microsoftonline.com/${getTenant(
    app
  )}/oauth2/v2.0/authorize?${qs.stringify({
    client_id: app.id,
    response_type: "code",
    redirect_uri: redirectUrl,
    response_mode: "form_post",
    scope: loginScopes.join(" "),
    prompt: "select_account",
    state: JSON.stringify({ app: app.id }),
  })}`;
}

export async function exchangeForCredentials(
  redirectUrl: string,
  code: string,
  app: MicrosoftAppRegistration
) {
  const credentials: MicrosoftOAuthCredentials = await rp.post(
    `https://login.microsoftonline.com/${getTenant(app)}/oauth2/v2.0/token`,
    {
      formData: {
        client_id: app.id,
        scope: loginScopes.join(" "),
        code: code,
        redirect_uri: redirectUrl,
        grant_type: "authorization_code",
        client_secret: app.secret,
      },
      json: true,
    }
  );
  credentials.expires = Date.now() + credentials.expires_in * 1000;
  const email = await getLoginEmail(credentials);
  delete credentials.id_token;
  await setCredentials(email, credentials, app);
  return { email, credentials };
}

function isPersonalAccount(idToken?: string) {
  if (!idToken) {
    return true;
  }
  const claims = JSON.parse(
    Buffer.from(idToken.split(".")[1], "base64url").toString()
  );
  return claims.tid === personalAccountTenantId;
}

// the email doubles as the SMTP username and db key, so it must be stable per account
async function getLoginEmail(credentials: MicrosoftOAuthCredentials) {
  const me: { userPrincipalName: string; mail: string | null } =
    await getMicrosoftGraphClient(credentials).api("/me").get();
  // personal accounts always used the UPN, keep it so existing users keep their rows;
  // work/school UPNs can differ from the actual address (e.g. @tenant.onmicrosoft.com)
  const personal = isPersonalAccount(credentials.id_token);
  const email = personal
    ? me.userPrincipalName
    : me.mail ?? me.userPrincipalName;
  console.log(`Login: ${email} (${personal ? "personal" : "work/school"})`);
  return email;
}

async function refreshCredentials(
  email: string,
  credentials: MicrosoftOAuthCredentials,
  app: MicrosoftAppRegistration
) {
  const token: MicrosoftOAuthCredentials = await rp.post(
    `https://login.microsoftonline.com/${getTenant(app)}/oauth2/v2.0/token`,
    {
      formData: {
        client_id: app.id,
        scope: scopes.join(" "),
        refresh_token: credentials.refresh_token,
        grant_type: "refresh_token",
        client_secret: app.secret,
      },
      json: true,
    }
  );
  token.expires = Date.now() + token.expires_in * 1000;
  token.refresh_token ??= credentials.refresh_token;
  delete token.id_token;
  await setCredentials(email, token, app);
  return token;
}

async function setCredentials(
  email: string,
  credentials: MicrosoftOAuthCredentials,
  app: MicrosoftAppRegistration
) {
  await upsert(
    "Tokens",
    [
      {
        email,
        token: JSON.stringify(credentials),
        smtp_password: crypto.randomBytes(16).toString("hex"),
        updated_at: new Date().toISOString(),
        app_id: app.id,
      },
    ],
    { ignoreIfSetFields: ["smtp_password"] }
  );
}

export function getMicrosoftGraphClient(token: MicrosoftOAuthCredentials) {
  const client = Client.init({
    authProvider: async (done) => {
      try {
        done(null, token.access_token);
      } catch (err) {
        done(err, null);
      }
    },
  });
  return client;
}
