#!/bin/bash
# issue/renew the SMTP certificate and reload the SMTP server
source "$(dirname "$0")/common.sh"
: "${CERT_DOMAIN:?set CERT_DOMAIN in deploy/.env}"
: "${CERT_EMAIL:?set CERT_EMAIL in deploy/.env}"
: "${CLOUDFLARE_CREDENTIALS:?set CLOUDFLARE_CREDENTIALS in deploy/.env}"

docker run --rm \
  -v "$(pwd)/certificates:/etc/letsencrypt/" \
  -v "$CLOUDFLARE_CREDENTIALS:/root/.secrets/cloudflare.ini:ro" \
  certbot/dns-cloudflare \
  certonly \
  --non-interactive \
  --agree-tos \
  --key-type rsa \
  --cert-name "$CERT_DOMAIN" \
  --email "$CERT_EMAIL" \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d "$CERT_DOMAIN"

# always reload (cheap) so a renewal is never missed after a failed run
docker compose exec -T app pm2 reload pm2.json --only sendas-smtp

if [ -n "${OWNER:-}" ]; then
  chown -R "$OWNER:$OWNER" ./certificates || echo "chown failed" >&2
fi
