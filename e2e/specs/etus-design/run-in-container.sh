#!/bin/sh
set -eu
cp /certs/ca.crt /usr/local/share/ca-certificates/etus-e2e-ca.crt
update-ca-certificates >/dev/null
mkdir -p "$HOME/.pki/nssdb"
certutil -d "sql:$HOME/.pki/nssdb" -N --empty-password 2>/dev/null || true
certutil -d "sql:$HOME/.pki/nssdb" -A -t "C,," -n etus-e2e-ca -i /certs/ca.crt
cd /opt/e2e
set -- npx playwright test -c suite/playwright.config.ts
if [ -n "${E2E_GREP:-}" ]; then set -- "$@" --grep "$E2E_GREP"; fi
for project in ${E2E_PROJECTS:-}; do set -- "$@" --project "$project"; done
exec "$@"
