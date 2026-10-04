#!/usr/bin/env bash
# Builds the vault's wallet engine from zingolib and installs it into vault/bin/
# (or $ENGINE_OUT). The same script runs locally and inside the Dockerfile.
#
#   bin/zingo-cli          clearnet build (the default engine):
#                          --no-default-features --features clearnet-test-mode
#                          + engine/zingo-cli-received-by-address.patch
#                          + engine/nu7/ (NU7 testnet backport, see engine/nu7/README.md)
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
NU7_DIR="$VAULT_DIR/engine/nu7"
NU7_PATCH="$NU7_DIR/zingolib-nu7.patch"
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

# --- NU7 (testnet activation height 4465026, branch id 0x77190AD9) -------------
# zingolib_v6.0.0 pins zcash_protocol 0.10.4, which knows no NU7 height and uses the
# placeholder branch id 0xFFFFFFFF behind --cfg zcash_unstable="nu7". From testnet
# block 4465026 an unpatched engine would sign with the NU6.3 branch id (every send
# rejected) and could not even parse post-activation transactions. engine/nu7/ holds
# a vendored zcash_protocol 0.10.4 with upstream's NU7 values (zcash_protocol
# 0.11.0-pre.0) backported, wired in with [patch.crates-io], plus the nu7 cfg and one
# match arm in zingolib/src/config.rs. Mainnet keeps no NU7 height.
rm -rf "$SRC/vendor/zcash_protocol"
mkdir -p "$SRC/vendor"
cp -R "$NU7_DIR/zcash_protocol" "$SRC/vendor/zcash_protocol"
if git apply --reverse --check "$NU7_PATCH" 2>/dev/null; then
  echo "nu7 patch already applied"
else
  git apply "$NU7_PATCH"
fi
# The vendored crate refuses to compile without this cfg; fail early with a clear message.
if ! grep -qF 'zcash_unstable=\"nu7\"' .cargo/config.toml; then
  echo "error: .cargo/config.toml lacks --cfg zcash_unstable=\"nu7\" after applying $NU7_PATCH" >&2
  exit 1
fi
# The pinned toolchain from rust-toolchain.toml (1.97.1 + clippy, rustfmt).
rustup toolchain install 2>/dev/null || rustup show active-toolchain

# Do not set RUSTFLAGS: zingolib's .cargo/config.toml (as patched above) enables
# the Ironwood (NU6.3) and NU7 code paths with --cfg zcash_unstable="nu6.3" and
# --cfg zcash_unstable="nu7"; a RUSTFLAGS environment variable would override
# both. If that ever happens the vendored zcash_protocol stops the build with a
# compile_error! instead of producing a pre-NU7 engine.

# Optional self-test of the NU7 backport (ENGINE_SELFTEST=1): compiles only the small
# zcash_protocol crate and runs its unit tests, which pin the testnet activation
# height 4465026, the branch id 0x77190AD9 and "mainnet has no NU7 height". It runs
# inside the vendored crate (excluded from the workspace, so `-p` cannot test it) and
# still picks up zingolib's .cargo/config.toml rustflags (nu6.3 + nu7 cfgs).
if [ "${ENGINE_SELFTEST:-0}" = "1" ]; then
  (cd vendor/zcash_protocol && CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$SRC/target}/nu7-selftest" \
     cargo test --lib -j "$JOBS" -- nu7 nu_ordering branch_id_for_height)
fi

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
