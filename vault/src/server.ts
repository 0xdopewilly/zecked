// ZECKED vault: a small always-on HTTP service holding a Zcash TESTNET hot
// wallet (zingo-cli). See ../README.md.
import http from "node:http";
import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual, createHash } from "node:crypto";
import { ZingoEngine } from "./zingo.ts";
import { Store } from "./store.ts";
import { Vault, HttpError } from "./vault.ts";
import { getLightdInfo } from "./lightwalletd.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const TOKEN = process.env.VAULT_TOKEN ?? "";
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const LIGHTWALLETD_URL = process.env.LIGHTWALLETD_URL ?? "https://testnet.zec.rocks:443";
// The container image sets VAULT_DATA_DIR=/data (a Railway volume). ZINGO_DATA_DIR is accepted as an alias.
const DATA_DIR = resolve(process.env.VAULT_DATA_DIR ?? process.env.ZINGO_DATA_DIR ?? join(ROOT, ".data"));
// clearnet: zingo-cli built with `--no-default-features --features clearnet-test-mode` (sync
//           and broadcast go straight to lightwalletd over TLS). Reliable; the default.
// mixnet:   the stock zingo-cli 6.x build, which forces sends over the Nym mixnet via nym-proxy.
const TRANSPORT = (process.env.ZINGO_TRANSPORT ?? "clearnet").toLowerCase();
if (TRANSPORT !== "clearnet" && TRANSPORT !== "mixnet") {
  console.error("ZINGO_TRANSPORT must be 'clearnet' or 'mixnet'");
  process.exit(1);
}
const ZINGO_CLI = resolve(process.env.ZINGO_CLI ?? join(ROOT, "bin", TRANSPORT === "mixnet" ? "zingo-cli-mixnet" : "zingo-cli"));
const NYM_PROXY = TRANSPORT === "mixnet" ? resolve(process.env.ZINGO_NYM_PROXY ?? join(ROOT, "bin", "nym-proxy")) : undefined;
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 20_000);

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));
}

if (TOKEN.length < 32) {
  console.error("VAULT_TOKEN must be set (at least 32 chars). Generate one: openssl rand -hex 32");
  process.exit(1);
}
if (!existsSync(ZINGO_CLI)) {
  console.error(`zingo-cli not found at ${ZINGO_CLI} (set ZINGO_CLI)`);
  process.exit(1);
}
// Everything the vault and zingo-cli write (wallet file, state, logs) is owner-only.
process.umask(0o077);
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
chmodSync(DATA_DIR, 0o700);

// TESTNET guard: refuse to start against anything but a testnet indexer.
async function lightdInfoWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await getLightdInfo(LIGHTWALLETD_URL);
    } catch (e) {
      if (attempt >= 12) {
        console.error(`cannot reach lightwalletd at ${LIGHTWALLETD_URL}: ${(e as Error).message}`);
        process.exit(1);
      }
      log("lightwalletd unreachable, retrying", { attempt, error: (e as Error).message });
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}
const info = await lightdInfoWithRetry();
if (info.chainName !== "test") {
  console.error(`lightwalletd at ${LIGHTWALLETD_URL} serves chain '${info.chainName}', not testnet. Refusing to start.`);
  process.exit(1);
}
log("lightwalletd ok", { url: LIGHTWALLETD_URL, vendor: info.vendor, version: info.version, tip: info.blockHeight, transport: TRANSPORT });

// First boot: create a NEW testnet wallet with its birthday just below the tip, so the
// first sync is quick. Offline and silent: none of zingo-cli's output is printed or kept,
// only the birthday number is parsed. The seed stays inside the wallet file.
if (!existsSync(join(DATA_DIR, "zingo-wallet.dat"))) {
  const birthday = Math.max(1, info.blockHeight - 10);
  const r = spawnSync(ZINGO_CLI, ["--chain", "testnet", "--data-dir", DATA_DIR, "--offline", "--birthday", String(birthday), "birthday"], {
    cwd: DATA_DIR,
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0 || !existsSync(join(DATA_DIR, "zingo-wallet.dat"))) {
    console.error(`could not create a new testnet wallet in ${DATA_DIR} (zingo-cli exit ${r.status})`);
    process.exit(1);
  }
  const walletBirthday = /^\s*(\d+)\s*$/m.exec(r.stdout ?? "")?.[1] ?? null;
  log("created new testnet wallet", { dataDir: DATA_DIR, requestedBirthday: birthday, walletBirthday: walletBirthday ? Number(walletBirthday) : null });
}

const engine = new ZingoEngine({
  bin: ZINGO_CLI,
  dataDir: DATA_DIR,
  server: LIGHTWALLETD_URL,
  nymProxy: NYM_PROXY,
  logFile: join(DATA_DIR, "zingo-cli.log"),
});
const store = new Store(DATA_DIR);
const vault = new Vault(engine, store, LIGHTWALLETD_URL, TRANSPORT);

engine.on("exit", (why: string) => log(shuttingDown ? "engine stopped" : "engine exited; restarting", { why }));
engine.on("recycle", (reason: string) => log("recycling wedged engine", { reason }));
engine.on("error", (e: Error) => log("engine restart failed", { error: e.message }));
engine.on("ready", async () => {
  await vault.onEngineReady();
  log("engine ready", { addressAttribution: vault.health().addressAttribution });
  void vault.syncTick();
});

const tokenHash = createHash("sha256").update(TOKEN).digest();
function authorized(req: http.IncomingMessage): boolean {
  const h = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return timingSafeEqual(createHash("sha256").update(m[1].trim()).digest(), tokenHash);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16 * 1024) throw new HttpError(413, "too_large", "request body too large");
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "bad_json", "body must be a JSON object");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;
  const started = Date.now();
  try {
    if (route === "GET /healthz") return send(res, 200, { ok: true });
    if (!authorized(req)) return send(res, 401, { error: "unauthorized", message: "missing or bad bearer token" });

    if (route === "GET /health") return send(res, 200, vault.health());
    // Owner-only repair (the bearer token is the owner's): rebuild the wallet's chain data from its birthday.
    if (route === "POST /rescan") return send(res, 202, vault.rescan(String((await readJson(req)).reason ?? "manual")));
    if (route === "POST /stash-address") return send(res, 200, await vault.stashAddress(await readJson(req)));
    if (route === "POST /user-address") return send(res, 200, await vault.userAddress(await readJson(req)));
    const dm = /^\/deposits\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && dm) return send(res, 200, await vault.deposits(decodeURIComponent(dm[1]), url.searchParams.get("minConf")));
    const fm = /^\/funding\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && fm) return send(res, 200, await vault.funding(decodeURIComponent(fm[1]), url.searchParams.get("minConf")));
    const pm = /^\/payout\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && pm) return send(res, 200, vault.payoutStatus(decodeURIComponent(pm[1])));
    if (route === "POST /payout") {
      const body = await readJson(req);
      const out = await vault.payout(body);
      log("payout sent", { key: out.key, stashId: body.stashId, amountZat: body.amountZat, txid: out.txid, duplicate: !!out.duplicate });
      return send(res, 200, out);
    }
    return send(res, 404, { error: "not_found" });
  } catch (e) {
    const err = e instanceof HttpError ? e : new HttpError(500, "internal", (e as Error)?.message ?? "error");
    if (err.status >= 500) log("request failed", { route, status: err.status, code: err.code, error: err.message });
    return send(res, err.status, { ...err.extra, error: err.code, message: err.message });
  } finally {
    if (process.env.VAULT_ACCESS_LOG) log("request", { route, ms: Date.now() - started, status: res.statusCode });
  }
});

server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `port ${PORT} on ${HOST} is already in use; set PORT to a free port` : `server error: ${e.message}`);
  process.exit(1);
});
let loop: NodeJS.Timeout | undefined;
server.listen(PORT, HOST, () => {
  log("vault listening", { host: HOST, port: PORT, network: "testnet", dataDir: DATA_DIR });
  // Only start the wallet engine once the port is ours.
  engine.start().catch((e: Error) => log("engine failed to start (will retry)", { error: e.message }));
  loop = setInterval(() => void vault.syncTick(), SYNC_INTERVAL_MS);
});

let shuttingDown = false;
async function shutdown(sig: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down", { sig });
  clearInterval(loop);
  server.close();
  await engine.stop();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
