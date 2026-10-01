#!/bin/bash
# Create the Entra app registration this project needs, from deploy/entra-app.json
# (a Microsoft Graph `application` body): delegated Mail.Send (e383f46e…) and
# User.Read (e1fe6dd8…) on Microsoft Graph, v2 tokens, Web redirect URIs.
#
# usage: deploy/create-entra-app.sh [--all-accounts] [--years N] "<display name>" <redirect uri>...
#   --all-accounts  work/school + personal accounts (AzureADandPersonalMicrosoftAccount,
#                   use "tenant": "common"); default is personal accounts only
#   --years N       client secret lifetime (default 100; directories with an app
#                   management policy may cap it)
#   e.g. deploy/create-entra-app.sh "Send As" https://sendas.example/auth http://localhost:3000/auth
#
# Apps for personal accounts allow at most 2 client secrets, so rotating later means
# deleting the unused one first (az ad app credential delete --id <app> --key-id <key>).
#
# Requires the Azure CLI signed in to the directory that should own the app
# (az login --tenant <tenant> --allow-no-subscriptions). Writes the client secret to a
# 0600 file instead of printing it. The publisher domain / verified publisher can only
# be set in the Entra portal (Branding & properties).
set -euo pipefail
cd "$(dirname "$0")/.."

audience=PersonalMicrosoftAccount
tenant=consumers
years=100
while [ $# -gt 0 ]; do
  case "$1" in
    --all-accounts)
      audience=AzureADandPersonalMicrosoftAccount
      tenant=common
      shift
      ;;
    --years)
      years=$2
      shift 2
      ;;
    *) break ;;
  esac
done
if [ $# -lt 2 ]; then
  sed -n '6,11p' "$0" >&2
  exit 1
fi
name=$1
shift
uris=$(printf '%s\n' "$@" | jq -R . | jq -s .)

body=$(jq --arg name "$name" --arg audience "$audience" --argjson uris "$uris" \
  '.displayName = $name | .signInAudience = $audience | .web.redirectUris = $uris' \
  deploy/entra-app.json)
app=$(az rest --method post --url https://graph.microsoft.com/v1.0/applications \
  --headers Content-Type=application/json --body "$body" --query appId -o tsv)
echo "Created app registration \"$name\": $app ($audience)"

secret_file="entra-app-$app.secret.json"
(umask 077 && az ad app credential reset --id "$app" --append --display-name sendas \
  --years "$years" --query password -o tsv 2>/dev/null |
  jq -R --arg id "$app" --arg tenant "$tenant" -c '{id: $id, secret: ., tenant: $tenant}' \
  >"$secret_file")
echo "Client secret (valid $years years) written to $secret_file as a MICROSOFT_APPS entry:"
echo "  add its contents to the single-line MICROSOFT_APPS array in .env, then delete the file."
