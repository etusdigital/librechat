#!/bin/sh
set -eu
set -a
. /state/chat-secrets.env
set +a
exec "$@"
