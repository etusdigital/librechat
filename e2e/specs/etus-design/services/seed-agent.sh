#!/bin/sh
set -eu
until node config/etus/seed-design-agent.js --file /suite/services/agent.json --author-email "$SEED_AUTHOR_EMAIL"; do
  sleep 2
done
touch /state/agent-seeded
