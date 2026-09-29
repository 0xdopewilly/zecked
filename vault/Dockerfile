# syntax=docker/dockerfile:1
# ZECKED vault: Zcash TESTNET hot-wallet service. Railway (or any Docker host).
#
#   docker build -t zecked-vault vault/
#   docker run -p 8787:8787 -v zecked-vault-data:/data -e VAULT_TOKEN=... zecked-vault
#
# Stage 1 compiles zingo-cli from zingolib tag zingolib_v6.0.0 with
# --no-default-features --features clearnet-test-mode plus the ZECKED
# received-by-address patch, by running the same scripts/build-engine.sh used
# for local builds. Measured: 6m40s compile on 4 jobs once sources are
# downloaded (~17 min fully cold on a slow link); peak ~2.3 GB RAM at JOBS=4.
# To skip compiling, pass --build-arg ZINGO_CLI_URL=<prebuilt binary URL> (and ZINGO_CLI_SHA256).

############################
# 1) engine builder
############################
FROM debian:bookworm-slim AS engine

ARG ZINGOLIB_TAG=zingolib_v6.0.0
ARG JOBS=4
ARG ZINGO_CLI_URL=""
ARG ZINGO_CLI_SHA256=""

SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# Build tools only (not shipped). Exact Debian versions are not pinned because
# bookworm point releases would break the build; the toolchain that matters
# (Rust 1.97.1 via rust-toolchain.toml, protoc 36.2, zingolib tag) is pinned.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential ca-certificates curl git unzip \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /vault
COPY scripts/build-engine.sh scripts/build-engine.sh
COPY engine/ engine/
RUN ZINGOLIB_TAG="${ZINGOLIB_TAG}" ZINGOLIB_SRC=/src JOBS="${JOBS}" \
    ZINGO_CLI_URL="${ZINGO_CLI_URL}" ZINGO_CLI_SHA256="${ZINGO_CLI_SHA256}" \
    scripts/build-engine.sh \
 && rm -rf /src/target /root/.cargo/registry /root/.cargo/git

############################
# 2) runtime (node 24, slim)
############################
FROM node:24-bookworm-slim AS runtime

# HOST: listen on all interfaces inside the container. PORT comes from the
# platform (Railway injects $PORT); the server defaults to 8787 without it.
# VAULT_DATA_DIR=/data: mount a persistent volume there, it holds the wallet.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    VAULT_DATA_DIR=/data \
    ZINGO_TRANSPORT=clearnet \
    ZINGO_CLI=/app/bin/zingo-cli

WORKDIR /app
COPY --from=engine /vault/bin/zingo-cli /app/bin/zingo-cli
COPY package.json ./
COPY src/ src/

# Runs as root on purpose: Railway mounts volumes owned by root, and a
# non-root user could not write the wallet (see Railway's RAILWAY_RUN_UID docs).
EXPOSE 8787
CMD ["node", "src/server.ts"]
