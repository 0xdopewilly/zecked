#!/usr/bin/env bash
# Builds the vault's wallet engine from zingolib and installs it into vault/bin/
# (or $ENGINE_OUT). The same script runs locally and inside the Dockerfile.
#
#   bin/zingo-cli          clearnet build (the default engine):
#                          --no-default-features --features clearnet-test-mode
#                          + engine/zingo-cli-received-by-address.patch
#   bin/zingo-cli-mixnet   stock build (sends over the Nym mixnet) + the same patch, BUILD_MIXNET=1 only
#   bin/nym-proxy          the mixnet proxy the stock build spawns,               BUILD_MIXNET=1 only
#
# Needs a C toolchain (build-essential), git and curl. rustup and protoc are
# installed into $HOME if missing (no root needed).
#
# Prebuilt shortcut: ZINGO_CLI_URL=<https url of a Linux x86_64 zingo-cli built by this
# script on glibc <= the runtime's> [ZINGO_CLI_SHA256=<hex>] skips compiling.
set -euo pipefail

TAG="${ZINGOLIB_TAG:-zingolib_v6.0.0}"
SRC="${ZINGOLIB_SRC:-$HOME/src/zingolib}"
JOBS="${JOBS:-4}"
PROTOC_VERSION="${PROTOC_VERSION:-36.2}"
VAULT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ENGINE_OUT:-$VAULT_DIR/bin}"
PATCH="$VAULT_DIR/engine/zingo-cli-received-by-address.patch"
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
mkdir -p "$OUT"

if [ -n "${ZINGO_CLI_URL:-}" ]; then
  echo "downloading prebuilt zingo-cli"
  curl -fsSL "$ZINGO_CLI_URL" -o "$OUT/zingo-cli.download"
  if [ -n "${ZINGO_CLI_SHA256:-}" ]; then
    echo "$ZINGO_CLI_SHA256  $OUT/zingo-cli.download" | sha256sum -c -
  fi
  install -m 755 "$OUT/zingo-cli.download" "$OUT/zingo-cli" && rm -f "$OUT/zingo-cli.download"
  "$OUT/zingo-cli" --version
  exit 0
fi

# --- toolchain (user space) -------------------------------------------------
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi
if ! command -v protoc >/dev/null 2>&1; then
  mkdir -p "$HOME/.local"
  curl -fsSL -o /tmp/protoc.zip "https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-linux-x86_64.zip"
  (cd "$HOME/.local" && unzip -o -q /tmp/protoc.zip) && rm -f /tmp/protoc.zip
  chmod +x "$HOME/.local/bin/protoc"
fi
export PROTOC="${PROTOC:-$(command -v protoc)}"

# --- source + patch ---------------------------------------------------------
if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/zingolabs/zingolib.git "$SRC"
fi
cd "$SRC"
if git apply --reverse --check "$PATCH" 2>/dev/null; then
  echo "received-by-address patch already applied"
else
  git apply "$PATCH"
fi
# The pinned toolchain from rust-toolchain.toml (1.97.1 + clippy, rustfmt).
rustup toolchain install 2>/dev/null || rustup show active-toolchain

# Do not set RUSTFLAGS: zingolib's .cargo/config.toml enables the Ironwood
# (NU6.3) code paths with --cfg zcash_unstable="nu6.3", and RUSTFLAGS would
# override it.

# --- 1) clearnet engine (default) --------------------------------------------
cargo build --release -p zingo-cli -j "$JOBS" --no-default-features --features clearnet-test-mode
install -m 755 target/release/zingo-cli "$OUT/zingo-cli"
strip "$OUT/zingo-cli" 2>/dev/null || true

# --- 2) optional: stock mixnet engine + nym-proxy ----------------------------
if [ "${BUILD_MIXNET:-0}" = "1" ]; then
  # zingolib gives each mixnet "birth" 3.5 s to prove its exit with one DNS round
  # trip. On slow links that is too tight, so it is raised to 12 s. This changes
  # only a liveness-probe timeout (unused by the clearnet build).
  sed -i 's/pub const SENTINEL_BUDGET: Duration = Duration::from_millis(3_500);/pub const SENTINEL_BUDGET: Duration = Duration::from_millis(12_000);/' \
    zingo-netutils/src/time.rs
  cargo build --release -p zingo-cli -j "$JOBS"
  install -m 755 target/release/zingo-cli "$OUT/zingo-cli-mixnet"
  cargo build --release -j "$JOBS" --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy
  install -m 755 zingo-netutils/target/release/nym-proxy "$OUT/nym-proxy"
fi

"$OUT/zingo-cli" --version
ls -la "$OUT"
