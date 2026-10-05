# ZECKED vault (Zcash TESTNET)

A small always-on HTTP service that holds ZECKED's **testnet** hot wallet. The Vercel app calls it to:

1. give each stash, and each signed-up user, its own shielded deposit address (plus a ZIP-321 URI),
2. see what has arrived at those addresses (stash funding, user deposits), and
3. send shielded testnet ZEC (TAZ) out: pay a winner, refund a hider, or process a user withdrawal.

**TESTNET ONLY.** The engine always runs with `--chain testnet`. At startup the service refuses any lightwalletd that doesn't report chain `test`. It creates only `utest1...` addresses, and it rejects payout addresses that aren't testnet.

## How it works

```
Vercel app ──HTTPS──► vault  (node src/server.ts; Railway, or local + tunnel)
                        │  one long-lived child process, stdin/stdout pipes
                        ▼
                      zingo-cli  (zingolib 6.0.0, Ironwood / NU6.3 + NU7 params, + ZECKED patches)
                        │  gRPC over TLS
                        ▼
                      testnet.zec.rocks:443  (lightwalletd v0.5.4; NU7 live on testnet since block 4,465,026)
```

- **Engine:** `zingo-cli` from [zingolib](https://github.com/zingolabs/zingolib) tag `zingolib_v6.0.0` ("Zingo CLI 0.1.1", `zl_6.0.0`). It is built from source with the Ironwood (NU6.3) code paths, as `--no-default-features --features clearnet-test-mode`, plus two small patches: `engine/zingo-cli-received-by-address.patch` (see Attribution) and the NU7 set in `engine/nu7/`, which vendors `zcash_protocol` 0.10.4 with the NU7 testnet parameters (activation height 4,465,026, consensus branch `0x77190AD9`) and builds with `--cfg zcash_unstable="nu7"`, so the engine follows the chain past NU7 activation (see `engine/nu7/README.md`).
- **Transport:** clearnet. Sync and broadcast go straight to lightwalletd over TLS, and the indexer sees the vault's IP address, which is fine for testnet. The stock 6.x build forces sends over the Nym mixnet, and that failed on most tries from the dev machine (`no proven exit`). It can still be built as `ZINGO_TRANSPORT=mixnet` (`BUILD_MIXNET=1`).
- The vault keeps **one** interactive zingo-cli session open. Only one process ever touches the wallet file, and commands are queued one at a time. If the child crashes, it restarts with backoff; recovery takes about 2 s.
- Wallet data lives in `VAULT_DATA_DIR` (`vault/.data` locally, `/data` in the container; dir 700, files 600): `zingo-wallet.dat`, `vault-state.json` (stash and user address maps, payout records), and the logs. **The seed phrase never leaves the wallet file.** The service refuses to run `recovery_info`, `export_ufvk`, `delete` or `clear`, and never logs raw engine output.
- **First boot:** if there's no wallet in `VAULT_DATA_DIR`, the vault creates a NEW testnet wallet offline, with its birthday 10 blocks below the current tip, and logs only the birthday number.
- A background loop runs every 20 s. It keeps the sync task running and refreshes `/health`.
- **Self-healing.** If the wallet is behind and makes no sync progress for 10 minutes (`SYNC_STALL_MS`), including when the engine stops answering, the vault kills and restarts the zingo-cli session.
  - This was seen once after a network drop: a dead gRPC connection wedged the session.
  - A single slow command doesn't trigger it, because a catch-up sync legitimately holds the wallet lock for minutes. While catching up, `/health` keeps its last balances and shows `synced:false`.
  - A payout interrupted by a restart stays locked as `sending`, so it's never sent twice.

## Attribution: who gets credited for incoming funds

Every stash and every user gets a **fresh diversified unified address** (Orchard/Ironwood + Sapling receivers, no transparent receiver). All of them come from the one wallet seed, so the wallet sees every payment to any of them.

Stock zingo-cli 6.x doesn't say *which* of our addresses a payment went to. Its value transfers are grouped per pool per transaction, with no receiving address. The vault therefore builds zingo-cli with a 56-line patch. The patch makes `notes all` also return `received_by_address`: every note the wallet holds, including spent ones, with the wallet address whose receiver it was paid to. It compares the note's recipient with the Orchard and Sapling receivers of each wallet address.

Funds are credited:

1. **By receiving address (primary).** A payment to Alice's deposit address is Alice's, even if the sender's wallet or faucet dropped the memo.
2. **By memo tag (secondary).** `ZU:<userId>` or `ZK:<stashId>` only counts when the note landed on an address that isn't assigned to any user or stash, for example the vault's main address. A memo can never move funds away from the address they were paid to, so nothing is credited twice.

What counts: external-scope notes with status `confirmed`, `mempool` or `transmitted`. Change notes, `failed` and `calculated` never count. Amounts are cumulative, so later spending of the notes doesn't reduce them. `confirmations` is `tip - height + 1`.

If the engine binary lacks the patch, `/health` shows `addressAttribution:false`, `/deposits` returns `501 engine_unpatched`, and `/funding` falls back to memo-only (`attribution:"memo-only"`).

## API

Every endpoint except `GET /healthz` requires `Authorization: Bearer $VAULT_TOKEN`. Errors look like `{ "error": "<code>", "message": "...", ...details }`. Ids: `userId` and `stashId` must match `[A-Za-z0-9_-]{1,64}`, and payout keys must match `[A-Za-z0-9_:.-]{1,128}`.

```bash
cd vault && set -a && . ./.env && set +a
V=http://127.0.0.1:$PORT; H="Authorization: Bearer $VAULT_TOKEN"
```

### `GET /health`
```json
{"network":"testnet","transport":"clearnet","synced":true,"height":4412452,"balanceZat":0,"spendableZat":0,
 "address":"utest1...","chainTip":4412452,"pendingRanges":[],"addressAttribution":true,"engineReady":true,
 "lastSyncAt":"2026-09-29T03:25:00.000Z","lastError":null,"pools":{"total_ironwood_balance":0,"...":0}}
```
- `height` is the wallet's scanned height, and `synced` means `height >= chainTip - 1`.
- `spendableZat` needs 3 confirmations.
- `address` is the vault's main address. Send funds there to top it up.

### `POST /user-address` `{ "userId": "user_123" }`
```json
{"address":"utest1...","uri":"zcash:utest1...?memo=WlU6dXNlcl8xMjM"}
```
- The address is stable per `userId`: repeat calls, including concurrent ones, return the same address.
- The URI has no amount. Its memo is base64url(`ZU:<userId>`) with no padding, and only acts as a fallback tag.

### `GET /deposits/:userId[?minConf=N]`
```json
{"userId":"user_123","address":"utest1...","receivedZat":0,"confirmedZat":0,"pendingZat":0,"confirmations":0,
 "txids":[],"lastTxAt":null,"transfers":[],"minConf":1,"synced":true}
```
- `receivedZat = confirmedZat + pendingZat`. `confirmedZat` sums transactions with at least `minConf` confirmations (default 1). `pendingZat` covers the mempool and younger transactions.
- `confirmations` is the minimum across transactions, and `lastTxAt` is ISO time or `null`.
- `transfers` has one entry per transaction: `[{txid, valueZat, status, confirmations, height, at, pools:["ironwood"|"orchard"|"sapling"], matchedBy:"address"|"memo"}]`.
- Returns `404 unknown_user` if `POST /user-address` wasn't called first.
- **Ledger tip:** credit a user when `confirmedZat` rises, e.g. with `?minConf=3`, and key the credits by txid (from `transfers`) so a transaction is never credited twice.

### `POST /stash-address` `{ "stashId": "abc123", "amountZat": 12500000 }`
```json
{"address":"utest1...","uri":"zcash:utest1...?amount=0.125&memo=Wks6YWJjMTIz"}
```
Stable per stash. Later calls with a new `amountZat` return the same address with an updated URI amount. The memo is base64url(`ZK:<stashId>`).

### `GET /funding/:stashId[?minConf=N]`
```json
{"fundedZat":0,"confirmations":0,"txids":[],"confirmedZat":0,"pendingZat":0,"lastTxAt":null,
 "address":"utest1...","attribution":"address+memo","synced":true,"transfers":[]}
```
This covers funds at the stash's own address, plus notes on unassigned addresses whose memo carries `ZK:<stashId>`. The fields `fundedZat`, `confirmations` and `txids` are unchanged from before.

### `POST /payout` `{ "key"?, "stashId"?, "to", "amountZat", "memo"? }`
```json
{"txid":"...","key":"withdraw:user_123:8f2c"}
```
- **Idempotent per key.** `key` is optional. With no `key`, the key is the `stashId`, which keeps the old one-payout-per-stash rule.
- Use `key` for withdrawals, e.g. `withdraw:<userId>:<nonce>`. At least one of `key` or `stashId` is required.
- `to` must be a testnet unified address with a shielded receiver, or a Sapling address (`ztestsapling1...`).
- The fee (ZIP-317) is paid by the vault on top of `amountZat`. `memo` is optional, up to 512 bytes. It defaults to `ZECKED ZK:<stashId>` or `ZECKED withdrawal`.

| Case | Response |
| --- | --- |
| sent | `200 {"txid","key"}` |
| retry with the same key and the same `to`+`amountZat` | `200 {"txid","key","duplicate":true}` (no second send) |
| same key, different body | `409 already_paid` (includes the original `txid`, `to`, `amountZat`) |
| same key already in flight | `409 payout_in_progress` |
| earlier send with this key timed out or crashed mid-send | `409 payout_unresolved` (`lastError`); check the wallet, then fix the record in `vault-state.json` |
| not enough spendable funds | `402 insufficient_funds` (`maxSendableZat`, `requestedZat`, `spendableZat`, `balanceZat`, `synced`) |
| bad address | `400 bad_address` / `not_testnet` / `not_shielded` |

A failure before a transaction is built (insufficient funds, a proposal error) doesn't use up the key.

### `GET /payout/:key`
Returns `{key, stashId, state:"sending"|"sent"|"failed", txid, to, amountZat, error, updatedAt}`, or `404`. A plain stashId works as the key.

### `GET /healthz`
Unauthenticated liveness check that returns `{"ok":true}`. Railway's health check uses it.

## Deploy on Railway

You'll need a Railway account, and this repo on GitHub with the `vault/` folder pushed.

1. **New project.** In Railway, click **New Project**, choose **Deploy from GitHub repo**, and pick the ZECKED repo.
2. **Point it at the vault folder.** Open the new service, then **Settings**:
   - **Root Directory:** `vault`
   - **Config-as-code / Railway config file:** `/vault/railway.json`. Include the leading slash; Railway doesn't look inside the root directory for this file by itself.

   Railway then builds with `vault/Dockerfile`. It only redeploys when something under `vault/` changes, and it checks `/healthz` after each deploy.
3. **Add a volume.** Right-click the service (or press **⌘K**), choose **Add Volume**, and set the mount path to **`/data`**. The wallet lives there. **Without the volume, every redeploy would create a brand-new empty wallet.**
4. **Set the variables.** Open **Variables** and add:
   - `VAULT_TOKEN`: a long random secret, at least 32 characters. Generate one with `openssl rand -hex 32` or a password manager. Put the **same value** into Vercel's env vars as `VAULT_TOKEN`.
   - `LIGHTWALLETD_URL`: `https://testnet.zec.rocks:443`. If `/health` stays `synced:false` for a long time, switch to the backup `https://zaino.testnet.unsafe.zec.rocks:443`. zec.rocks briefly stopped serving block ranges once during testing.
   - Don't set `PORT`; Railway provides it.
5. **Deploy.** Click **Deploy** and wait. The first build compiles the Zcash wallet engine from source and takes a while; see "Build time and memory" below.
   When it's up, the **Deploy Logs** show `created new testnet wallet` (first boot only), then `vault listening` and `engine ready`.
6. **Give it a public address.** Go to **Settings → Networking → Generate Domain**. If Railway asks for a port, use the `port` value from the `vault listening` log line. You'll get something like `https://zecked-vault-production.up.railway.app`.
7. **Connect the app.** In Vercel, set `VAULT_URL` to that domain and `VAULT_TOKEN` to the same secret, then redeploy the app.
8. **Check it.** Open `https://<your-domain>/healthz` in a browser; it should show `{"ok":true}`. `/health` needs the token.
9. **Fund it.** Get the vault's address from `/health` (or a user's address from the app), and use a testnet faucet: https://faucet.testnet.valargroup.dev or https://zcashfaucet.jinolabs.xyz.

Things to know:
- Keep it to **one replica**. Railway doesn't allow replicas with a volume anyway. Two copies would fight over the same wallet.
- Redeploys cause a short downtime, because Railway stops the old container before the new one mounts the volume.
- The container runs as root so it can write to Railway's root-owned volume.
- **Back up the seed** once the wallet has real test funds. Open a Railway shell on the service and run `/app/bin/zingo-cli --chain testnet --data-dir /data --offline recovery_info`. Only do this while the vault is stopped (for example, with the start command temporarily set to `sleep infinity`), because two zingo-cli processes must never open the wallet at once. Store the seed privately.

### Build time and memory

The Dockerfile compiles about 370 Rust crates, including heavy zero-knowledge proving libraries.

- **Time:** on the dev machine (8 cores, `JOBS=4`), a from-scratch build through `scripts/build-engine.sh` took **6 min 40 s** once the Rust sources were downloaded. The very first build took **~17 min**, including the toolchain and ~400 MB of crate downloads over a slow link. Expect roughly **10-20 min** on Railway for a cold build. Later builds may reuse Railway's layer cache, but that's not guaranteed.
- **Memory:** peak compiler memory was **2.3 GB** with `JOBS=4` (measured). Keep at least 4 GB free for the build. The build argument `JOBS=2` lowers the peak, at the cost of time.
- **Railway's build limits:** Railway doesn't publish exact build timeout or build RAM figures per plan, and community reports mention timeouts somewhere between about 10 and 30 minutes depending on plan. So a from-source build **may time out, especially on the trial or free plan.**

If it does, use a prebuilt engine instead of compiling on Railway:
1. Build the image once somewhere with enough time, e.g. a GitHub Actions job running `docker build vault/`, and push it to a registry such as GHCR. In Railway, deploy the service from that **Docker image** instead of the repo.
2. Or publish a prebuilt `zingo-cli` binary and set the Railway variables `ZINGO_CLI_URL` (and `ZINGO_CLI_SHA256`). The Dockerfile then downloads that binary instead of compiling it, which cuts the build to about a minute. The binary must be built inside Debian **bookworm** (glibc 2.36) or older, for example with this Dockerfile's first stage. A binary compiled on a newer distro, like the Ubuntu 26.04 dev machine (glibc 2.43), **won't start** in the container.

## Run locally

```bash
cd vault
npm install                 # dev-only deps (typescript, @types/node); the service itself has no runtime deps
scripts/build-engine.sh     # once: builds bin/zingo-cli (see below)
scripts/start.sh            # background; creates .env (mode 600) with a random VAULT_TOKEN on first run
tail -f .data/vault.log
scripts/stop.sh             # saves the wallet and stops
```

On the dev machine, port 8787 is taken by another app, so `.env` sets `PORT=8788`. To expose a local vault, run `bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:8788`. The default QUIC protocol dropped here, and the URL changes on every restart.

### Build the engine

`scripts/build-engine.sh` is what the Dockerfile runs, step for step:

1. It installs rustup (minimal profile) and protoc 36.2 into `$HOME` if they're missing.
2. It clones `zingolib_v6.0.0` into `~/src/zingolib`, applies `engine/zingo-cli-received-by-address.patch`, copies `engine/nu7/zcash_protocol` into `vendor/` and applies `engine/nu7/zingolib-nu7.patch`. The patch steps are idempotent, and the build fails if the NU7 cfg is missing.
3. It installs the pinned toolchain from `rust-toolchain.toml` (1.97.1).
4. It runs `cargo build --release -p zingo-cli --no-default-features --features clearnet-test-mode`, then installs and strips `bin/zingo-cli`.

Needs: `build-essential`, `git`, `curl` (and `unzip` if protoc has to be downloaded). Don't set `RUSTFLAGS`, because zingolib's `.cargo/config.toml` enables Ironwood and NU7 with `--cfg zcash_unstable="nu6.3"` and `--cfg zcash_unstable="nu7"`, and `RUSTFLAGS` would override it. `BUILD_MIXNET=1` also builds `bin/zingo-cli-mixnet` and `bin/nym-proxy`.

### Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `VAULT_TOKEN` | (required, at least 32 chars) | Bearer token |
| `LIGHTWALLETD_URL` | `https://testnet.zec.rocks:443` | Testnet lightwalletd or zaino endpoint |
| `PORT` | `8787` | HTTP port (Railway sets it) |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the container) | Bind address |
| `VAULT_DATA_DIR` (alias `ZINGO_DATA_DIR`) | `vault/.data` (`/data` in the container) | Wallet and state |
| `ZINGO_TRANSPORT` | `clearnet` | `clearnet` or `mixnet` |
| `ZINGO_CLI`, `ZINGO_NYM_PROXY` | `bin/...` | Engine binary overrides |
| `SYNC_INTERVAL_MS` | `20000` | Background sync interval |
| `SYNC_STALL_MS` | `600000` | Recycle the engine after this long with no sync progress |
| `VAULT_ACCESS_LOG` | unset | Set it to log one line per request |
| Build args: `JOBS`, `ZINGOLIB_TAG`, `ZINGO_CLI_URL`, `ZINGO_CLI_SHA256` | `4`, `zingolib_v6.0.0`, empty | Dockerfile only |

## Testnet faucets
- Valar Group: https://faucet.testnet.valargroup.dev (0.125 TAZ per IP per day)
- Jino Labs: https://zcashfaucet.jinolabs.xyz (shielded, browser proof-of-work)

If a faucet refuses an address, try a user or stash address. Those include a Sapling receiver.

## Development
```bash
npm test            # ZIP-321, memo, and attribution unit tests
npm run typecheck
```
Source layout: `src/server.ts` (HTTP, auth, loop, first-boot wallet), `src/vault.ts` (endpoint logic and attribution), `src/zingo.ts` (zingo-cli session driver), `src/lightwalletd.ts` (chain tip and chain name over gRPC), `src/zip321.ts`, `src/store.ts`, `engine/*.patch`.
