# ZECKED vault (Zcash TESTNET)

A small always-on HTTP service that holds ZECKED's **testnet** hot wallet. The Vercel app calls it to:

1. get a funding request (a shielded address plus a ZIP-321 URI) for each stash,
2. see when a stash has been funded, and
3. pay the winner, or refund the hider, in shielded testnet ZEC (TAZ).

**TESTNET ONLY.** The engine always runs with `--chain testnet`. At startup the service refuses any lightwalletd that doesn't report chain `test`. It creates only `utest1...` addresses, and it rejects payout addresses that aren't testnet.

## How it works

```
Vercel app ──HTTPS──► tunnel ──► vault  (node src/server.ts, 127.0.0.1:$PORT)
                                   │  one long-lived child process, stdin/stdout pipes
                                   ▼
                                 zingo-cli  (zingolib 6.0.0, Ironwood / NU6.3)
                                   │  gRPC over TLS
                                   ▼
                                 testnet.zec.rocks:443  (lightwalletd, Zebra 6.3.0)
```

- **Engine:** `zingo-cli` from [zingolib](https://github.com/zingolabs/zingolib) tag `zingolib_v6.0.0` (released 2026-09-08, "Zingo CLI 0.1.1", git description `zl_6.0.0`). It is built from source with the Ironwood (NU6.3) code paths enabled.
- **Transport:**
  - `clearnet` (default): `bin/zingo-cli` is built with `--no-default-features --features clearnet-test-mode`, so sync and broadcast go straight to lightwalletd over TLS. The indexer sees the vault's IP address, which is fine for a testnet server.
  - `mixnet`: the stock zingo-cli 6.x build, which forces every send over the Nym mixnet through `bin/nym-proxy`. **It didn't work reliably from this machine.** Bringing up the mixnet session failed with `no proven exit: 6 births each proved nothing`: zingolib races random Nym exits, and most of the ones it drew here didn't carry traffic. One try in about eight succeeded. It's built and available as `ZINGO_TRANSPORT=mixnet` for later.
- The vault keeps **one** interactive zingo-cli session open, so the wallet stays loaded and only one process ever writes the wallet file. Commands are queued one at a time. If the child crashes, it restarts with backoff; recovery took about 2 s in testing.
- Wallet data lives in `vault/.data/` (dir 700, files 600): `zingo-wallet.dat`, `vault-state.json` (stash to address map, payout records), `vault.log` and `zingo-cli.log`. **The seed phrase never leaves the wallet file.** The service refuses to run `recovery_info`, `export_ufvk`, `delete` or `clear`, and never logs raw engine output.
- A background loop runs every `SYNC_INTERVAL_MS` (20 s by default). It keeps the sync task running and refreshes the balance and height that `/health` returns.

## Build the engine (once)

You need rustup (the minimal profile is fine), `build-essential` and `protoc`. None of them need root:

```bash
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
# protoc: unzip protoc-<ver>-linux-x86_64.zip from github.com/protocolbuffers/protobuf/releases into ~/.local
vault/scripts/build-engine.sh                  # clearnet engine -> vault/bin/zingo-cli  (~17 min cold)
BUILD_MIXNET=1 vault/scripts/build-engine.sh   # also bin/zingo-cli-mixnet + bin/nym-proxy (~20 min more)
```

- The script clones `zingolib_v6.0.0` into `~/src/zingolib`, and rustup fetches the pinned toolchain (1.97.1).
- Don't set `RUSTFLAGS`: zingolib's `.cargo/config.toml` enables Ironwood with `--cfg zcash_unstable="nu6.3"`, and `RUSTFLAGS` would override it.
- The mixnet build carries one local patch: `SENTINEL_BUDGET` is raised from 3.5 s to 12 s, because a single exit-proof round trip often takes longer than 3.5 s on a slow link.

## Run

```bash
cd vault
npm install            # dev-only deps (typescript, @types/node); the service itself has no runtime deps
scripts/start.sh       # background; creates .env (mode 600) with a random VAULT_TOKEN on first run
tail -f .data/vault.log
scripts/stop.sh        # saves the wallet and stops
node src/server.ts     # or in the foreground
```

On the first start, zingo-cli creates the wallet in `.data/`, with its birthday near the current tip. This wallet was created offline with `--birthday tip-10`, and zingolib set the birthday to 4411314. You need Node 22.18+ or 24; the TypeScript runs directly through Node's type stripping.

> On this machine, port 8787 is already taken by another app (gig-scout, uvicorn), so `.env` sets `PORT=8788`.

### Environment variables (`vault/.env` is loaded automatically)

| Var | Default | Meaning |
| --- | --- | --- |
| `VAULT_TOKEN` | (required, at least 32 chars) | Bearer token for every endpoint except `/healthz` |
| `LIGHTWALLETD_URL` | `https://testnet.zec.rocks:443` | Testnet lightwalletd or zaino endpoint. Also working: `https://zaino.testnet.unsafe.zec.rocks:443` |
| `PORT` | `8787` | HTTP port (`8788` here) |
| `HOST` | `127.0.0.1` | Bind address. Keep it on loopback and expose it through a tunnel. |
| `ZINGO_TRANSPORT` | `clearnet` | `clearnet` (bin/zingo-cli) or `mixnet` (bin/zingo-cli-mixnet + bin/nym-proxy) |
| `SYNC_INTERVAL_MS` | `20000` | Background sync and refresh interval |
| `ZINGO_CLI` | depends on transport | Engine binary override |
| `ZINGO_NYM_PROXY` | `bin/nym-proxy` | Mixnet proxy (mixnet transport only) |
| `VAULT_DATA_DIR` | `vault/.data` | Wallet and state directory |
| `VAULT_ACCESS_LOG` | unset | Set it to log one line per request |

## API

Every endpoint except `GET /healthz` requires `Authorization: Bearer $VAULT_TOKEN`. Errors look like `{ "error": "<code>", "message": "..." }`.

```bash
cd vault && set -a && . ./.env && set +a
V=http://127.0.0.1:$PORT; H="Authorization: Bearer $VAULT_TOKEN"
```

### `GET /health`
```bash
curl -s -H "$H" $V/health
# {"network":"testnet","transport":"clearnet","synced":true,"height":4411626,"balanceZat":0,"spendableZat":0,
#  "address":"utest1...","chainTip":4411626,"pendingRanges":[],"engineReady":true,"lastSyncAt":"...","lastError":null,"pools":{...}}
```
- `height` is the wallet's fully scanned height, and `chainTip` is the lightwalletd tip. `synced` means `height >= chainTip - 1`.
- `balanceZat` is the total across pools, including unconfirmed funds. `spendableZat` is what can be spent now (zingo-cli requires 3 confirmations).
- `address` is the wallet's default unified address, with an Orchard/Ironwood receiver. Fund the vault by sending to it.

### `POST /stash-address`
```bash
curl -s -H "$H" -H 'content-type: application/json' -d '{"stashId":"abc123","amountZat":12500000}' $V/stash-address
# {"address":"utest1...","uri":"zcash:utest1...?amount=0.125&memo=Wks6YWJjMTIz"}
```
- The first call for a `stashId` creates a fresh diversified unified address with Orchard/Ironwood and Sapling receivers and no transparent receiver. Later calls return the same address, and the URI picks up the new `amountZat`.
- `uri` is ZIP-321: `amount` is in decimal ZEC, and `memo` is the base64url of `ZK:<stashId>` without padding.
- `stashId` must match `[A-Za-z0-9_-]{1,64}`.

### `GET /funding/:stashId`
```bash
curl -s -H "$H" $V/funding/abc123
# {"fundedZat":0,"confirmations":0,"txids":[],"synced":true,"transfers":[]}
```
- This sums every **received** transfer whose memo is `ZK:<stashId>`, or starts with `ZK:<stashId>` followed by whitespace. `ZK:abc` doesn't match `ZK:abcd`.
- Mempool transactions count, with 0 confirmations. `confirmations` is the minimum across the funding transactions.
- Suggested rule: treat a stash as funded when `fundedZat >= amount && confirmations >= 3`.
- Attribution is **by memo only**. A payment without the memo isn't attributed to any stash, even if it went to the stash's address.

### `POST /payout`
```bash
curl -s -H "$H" -H 'content-type: application/json' \
  -d '{"stashId":"abc123","to":"utest1...","amountZat":12000000,"memo":"You got ZECKED!"}' $V/payout
# 200 {"txid":"..."}
# 402 {"error":"insufficient_funds","message":"insufficient funds: can send at most 0 zat after fees, requested 12000000 zat",
#      "requestedZat":12000000,"maxSendableZat":0,"spendableZat":0,"balanceZat":0,"synced":true}
```
- `to` must be a testnet unified address with a shielded receiver, or a Sapling address (`ztestsapling1...`). The API returns `400 not_testnet` for mainnet addresses and `400 not_shielded` for transparent or TEX addresses.
- The fee (ZIP-317) is paid by the vault on top of `amountZat`.
- `memo` is optional, up to 512 bytes. It defaults to `ZECKED ZK:<stashId>`.
- **One payout per stash, either the winner or the refund.**
  - Retrying with the same `to` and `amountZat` returns the original `{txid, duplicate:true}`. A different body gets `409 already_paid`.
  - A concurrent retry gets `409 payout_in_progress`.
  - A failure before a transaction is built (insufficient funds, a proposal error) can be retried.
  - A failure at or after broadcast, a timeout, or an engine crash mid-send locks the stash (`502` or `409 payout_unresolved`) until someone checks it. Look at `GET /payout/:stashId`, `.data/vault-state.json`, and zingo-cli's `transactions` list. Then fix or delete the record in `vault-state.json` while the vault is stopped.

### `GET /payout/:stashId`
Returns `{stashId, state: "sending"|"sent"|"failed", txid, to, amountZat, error, updatedAt}`, or `404` if there's no payout for that stash.

### `GET /healthz`
Unauthenticated liveness check that returns `{"ok":true}`.

## Exposing it to the Vercel app

The vault binds to `127.0.0.1`. Put a tunnel in front of it and store `VAULT_URL` and `VAULT_TOKEN` in Vercel env vars. Only call the vault from server code: route handlers or server actions, never the browser.

**Cloudflare quick tunnel** (free, no account). The binary is at `vault/bin/cloudflared` (2026.9.3):
```bash
vault/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:8788
# prints https://<random-words>.trycloudflare.com  -> set VAULT_URL to that in Vercel
```
- Use `--protocol http2`. The default QUIC connection dropped here with `datagram manager error`. Over HTTP/2, `/healthz`, the 401 path and an authorized `/health` all worked through the tunnel.
- Right after the tunnel starts, the new hostname can take a few seconds to resolve.
- The quick-tunnel URL changes every time cloudflared restarts. For a stable hostname, use a named tunnel with a free Cloudflare account (`cloudflared tunnel login && cloudflared tunnel create zecked-vault`), or host the vault elsewhere:
  - **Fly.io / Railway:** run `node src/server.ts` in a container with `bin/zingo-cli`, set `HOST=0.0.0.0`, and mount a **persistent volume** at `VAULT_DATA_DIR`. The wallet file must survive redeploys. Run exactly one instance, because two instances would double-spend the same notes.

Minimal server-side client for the Next.js app:
```ts
// server-only
async function vault<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${process.env.VAULT_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${process.env.VAULT_TOKEN}`, "content-type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.message ?? res.statusText), { status: res.status, code: json.error });
  return json as T;
}
// const { address, uri } = await vault("/stash-address", { method: "POST", body: { stashId, amountZat } });
// const { fundedZat, confirmations } = await vault(`/funding/${stashId}`);
// const { txid } = await vault("/payout", { method: "POST", body: { stashId, to, amountZat, memo } });
```
Payouts include proof generation, so give that route enough `maxDuration`, or fire and poll with `GET /payout/:stashId`. Retrying `POST /payout` with the same body is safe.

## Funding the vault (testnet faucets)

Send TAZ to the `address` from `/health`:
- Valar Group faucet: https://faucet.testnet.valargroup.dev. It pays 0.125 TAZ per IP per day, shielded, from zecd. Its API is `POST /api/claim {"address":"utest1..."}`.
- Jino Labs faucet: https://zcashfaucet.jinolabs.xyz. It sends shielded z2z drips and uses a browser proof-of-work.

If a faucet can't pay to an Orchard-only unified address, use an address from `POST /stash-address`. It also has a Sapling receiver, and funds sent there land in the same wallet. Funds become spendable after 3 confirmations, about 4 minutes at 75 s per block.

## Backup and recovery

The seed phrase is only in `.data/zingo-wallet.dat`. To back it up, stop the vault and read it yourself in a private terminal. Never paste it anywhere or commit it:
```bash
scripts/stop.sh
bin/zingo-cli --chain testnet --data-dir .data --offline recovery_info
```
If you lose `.data/` without a seed backup, you lose the testnet funds.

## Development

```bash
npm test          # ZIP-321 and memo-matching unit tests
npm run typecheck
```
Source layout: `src/server.ts` (HTTP, auth, loop), `src/vault.ts` (endpoint logic), `src/zingo.ts` (zingo-cli session driver), `src/lightwalletd.ts` (chain tip and chain name over gRPC), `src/zip321.ts`, `src/store.ts`.
