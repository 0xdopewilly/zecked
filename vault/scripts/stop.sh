#!/usr/bin/env bash
# Stops the background vault; the wallet is saved on the way out.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .data/vault.pid ] && kill -0 "$(cat .data/vault.pid)" 2>/dev/null; then
  pid="$(cat .data/vault.pid)"
  kill -TERM "$pid"
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && { echo "vault did not stop, killing"; kill -KILL "$pid"; }
  rm -f .data/vault.pid
  echo "vault stopped"
else
  echo "vault not running"
fi
