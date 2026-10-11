#!/bin/sh
set -eu
mkdir -p /certs /state
if [ ! -f /certs/edge.crt ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=etus-e2e-ca \
    -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign \
    -keyout /certs/ca.key -out /certs/ca.crt 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj /CN=chat.etus.test \
    -keyout /certs/edge.key -out /certs/edge.csr 2>/dev/null
  printf 'subjectAltName=DNS:chat.etus.test,DNS:idp.etus.test,DNS:hub.etus.test,DNS:router.etus.test\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' > /certs/edge.ext
  openssl x509 -req -in /certs/edge.csr -CA /certs/ca.crt -CAkey /certs/ca.key -CAcreateserial \
    -days 3 -extfile /certs/edge.ext -out /certs/edge.crt 2>/dev/null
  rm -f /certs/ca.key /certs/edge.csr /certs/edge.ext /certs/ca.srl
  chmod 644 /certs/*
fi
rand() { openssl rand -hex "$1"; }
[ -f /state/chat-secrets.env ] || {
  echo "CREDS_KEY=$(rand 32)"
  echo "CREDS_IV=$(rand 16)"
  echo "JWT_SECRET=$(rand 32)"
  echo "JWT_REFRESH_SECRET=$(rand 32)"
  echo "OPENID_SESSION_SECRET=$(rand 32)"
} > /state/chat-secrets.env
chmod 644 /state/chat-secrets.env
chmod 1777 /state
