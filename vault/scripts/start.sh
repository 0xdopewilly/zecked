#!/usr/bin/env bash
# Starts the vault in the background. Logs: vault/.data/vault.log, pid: vault/.data/vault.pid
# Creates vault/.env with a random VAULT_TOKEN on first run.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

mkdir -p .data && chmod 700 .data
if [ ! -f .env ]; then
  umask 077
  printf 'VAULT_TOKEN=%s\nPORT=8788\nLIGHTWALLETD_URL=https://testnet.zec.rocks:443\n' "$(openssl rand -hex 32 2>/dev/null || node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')" > .env
  echo "created .env with a new VAULT_TOKEN"
fi
chmod 600 .env

if [ -f .data/vault.pid ] && kill -0 "$(cat .data/vault.pid)" 2>/dev/null; then
  echo "vault already running (pid $(cat .data/vault.pid))"
  exit 0
fi

nohup node src/server.ts >> .data/vault.log 2>&1 &
echo $! > .data/vault.pid
echo "vault started (pid $!), log: $(pwd)/.data/vault.log"
