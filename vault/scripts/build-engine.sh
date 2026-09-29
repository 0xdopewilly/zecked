#!/usr/bin/env bash
# Builds the wallet engine from zingolib and installs it into vault/bin/.
#
#   bin/zingo-cli          clearnet build (default engine): --no-default-features --features clearnet-test-mode
#   bin/zingo-cli-mixnet   stock build (Nym mixnet for sends), only with BUILD_MIXNET=1
#   bin/nym-proxy          the mixnet proxy the stock build spawns, only with BUILD_MIXNET=1
#
# Needs rustup (minimal profile is fine), a C compiler (build-essential) and
# protoc. Nothing is installed system-wide:
#   curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
#   protoc: unzip protoc-<ver>-linux-x86_64.zip (github.com/protocolbuffers/protobuf releases) into ~/.local
set -euo pipefail

TAG="${ZINGOLIB_TAG:-zingolib_v6.0.0}"
SRC="${ZINGOLIB_SRC:-$HOME/src/zingolib}"
JOBS="${JOBS:-4}"
VAULT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
export PROTOC="${PROTOC:-$(command -v protoc)}"

if [ ! -d "$SRC/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/zingolabs/zingolib.git "$SRC"
fi
cd "$SRC"
mkdir -p "$VAULT_DIR/bin"

# Do not set RUSTFLAGS: zingolib's .cargo/config.toml enables the Ironwood
# (NU6.3) code paths with --cfg zcash_unstable="nu6.3", and RUSTFLAGS would
# override it. The pinned toolchain (rust-toolchain.toml) is fetched by rustup.

# 1) Clearnet engine (default). Sync and broadcast go straight to lightwalletd over TLS.
cargo build --release -p zingo-cli -j "$JOBS" --no-default-features --features clearnet-test-mode
install -m 755 target/release/zingo-cli "$VAULT_DIR/bin/zingo-cli"

# 2) Optional: stock mixnet engine + nym-proxy.
if [ "${BUILD_MIXNET:-0}" = "1" ]; then
  # zingolib gives each mixnet "birth" 3.5 s to prove its exit with one DNS
  # round trip. On slow links that is too tight, so it is raised to 12 s.
  # This only changes a liveness-probe timeout.
  sed -i 's/pub const SENTINEL_BUDGET: Duration = Duration::from_millis(3_500);/pub const SENTINEL_BUDGET: Duration = Duration::from_millis(12_000);/' \
    zingo-netutils/src/time.rs
  cargo build --release -p zingo-cli -j "$JOBS"
  install -m 755 target/release/zingo-cli "$VAULT_DIR/bin/zingo-cli-mixnet"
  cargo build --release -j "$JOBS" --manifest-path zingo-netutils/Cargo.toml --features nym --bin nym-proxy
  install -m 755 zingo-netutils/target/release/nym-proxy "$VAULT_DIR/bin/nym-proxy"
fi

ls -la "$VAULT_DIR/bin"
