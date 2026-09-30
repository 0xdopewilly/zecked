// Tiny key-value layer. Uses Upstash Redis when configured (production / Vercel),
// otherwise an in-process memory store (local dev, single-instance demos).
import { AsyncLocalStorage } from "node:async_hooks";
import { Redis } from "@upstash/redis";
import { Redis as IORedis } from "ioredis";

/* Per-request KV accounting, reported as a Server-Timing header by the API (see route.ts). */
type KvStats = { calls: number; ms: number };
const kvStore = new AsyncLocalStorage<KvStats>();
export function withKvStats<T>(fn: () => Promise<T>) {
  const stats: KvStats = { calls: 0, ms: 0 };
  return kvStore.run(stats, async () => ({ result: await fn(), stats }));
}
function instrument(inner: KV): KV {
  return new Proxy(inner, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const st = kvStore.getStore();
        if (!st) return (v as (...a: unknown[]) => unknown).apply(target, args);
        const t0 = performance.now();
        st.calls++;
        const out = (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        return Promise.resolve(out).finally(() => (st.ms += performance.now() - t0));
      };
    },
  });
}

export interface KV {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: boolean; exSeconds?: number }): Promise<boolean>;
  del(key: string): Promise<void>;
  incr(key: string, by?: number): Promise<number>;
  rpush(key: string, value: unknown): Promise<number>;
  lpushTrim(key: string, value: unknown, max: number): Promise<void>;
  lrange<T>(key: string, start: number, stop: number): Promise<T[]>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zincr(key: string, member: string, by: number): Promise<number>;
  zrevrange(key: string, start: number, stop: number): Promise<{ member: string; score: number }[]>;
  zrem(key: string, member: string): Promise<void>;
  kind: "redis" | "memory";
}

class MemoryKV implements KV {
  kind = "memory" as const;
  private m = new Map<string, { v: unknown; exp?: number }>();
  private live(key: string) {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (e.exp && e.exp < Date.now()) {
      this.m.delete(key);
      return undefined;
    }
    return e;
  }
  async get<T>(key: string) {
    const e = this.live(key);
    return e ? (structuredClone(e.v) as T) : null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; exSeconds?: number }) {
    if (opts?.nx && this.live(key)) return false;
    this.m.set(key, { v: structuredClone(value), exp: opts?.exSeconds ? Date.now() + opts.exSeconds * 1000 : undefined });
    return true;
  }
  async del(key: string) {
    this.m.delete(key);
  }
  async incr(key: string, by = 1) {
    const cur = Number((this.live(key)?.v as number) || 0) + by;
    this.m.set(key, { v: cur });
    return cur;
  }
  async rpush(key: string, value: unknown) {
    const arr = ((this.live(key)?.v as unknown[]) || []).concat([structuredClone(value)]);
    this.m.set(key, { v: arr });
    return arr.length;
  }
  async lpushTrim(key: string, value: unknown, max: number) {
    const arr = [structuredClone(value)].concat((this.live(key)?.v as unknown[]) || []).slice(0, max);
    this.m.set(key, { v: arr });
  }
  async lrange<T>(key: string, start: number, stop: number) {
    const arr = ((this.live(key)?.v as unknown[]) || []) as T[];
    return structuredClone(arr.slice(start, stop === -1 ? undefined : stop + 1));
  }
  private zget(key: string) {
    return ((this.live(key)?.v as Record<string, number>) || {}) as Record<string, number>;
  }
  async zadd(key: string, score: number, member: string) {
    const z = this.zget(key);
    z[member] = score;
    this.m.set(key, { v: z });
  }
  async zincr(key: string, member: string, by: number) {
    const z = this.zget(key);
    z[member] = (z[member] || 0) + by;
    this.m.set(key, { v: z });
    return z[member];
  }
  async zrevrange(key: string, start: number, stop: number) {
    const z = this.zget(key);
    const rows = Object.entries(z)
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => b.score - a.score);
    return rows.slice(start, stop === -1 ? undefined : stop + 1);
  }
  async zrem(key: string, member: string) {
    const z = this.zget(key);
    delete z[member];
    this.m.set(key, { v: z });
  }
}

class RedisKV implements KV {
  kind = "redis" as const;
  constructor(private r: Redis, private prefix: string) {}
  private k(key: string) {
    return this.prefix + key;
  }
  async get<T>(key: string) {
    return ((await this.r.get<T>(this.k(key))) ?? null) as T | null;
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; exSeconds?: number }) {
    const o: Record<string, unknown> = {};
    if (opts?.nx) o.nx = true;
    if (opts?.exSeconds) o.ex = opts.exSeconds;
    const res = await this.r.set(this.k(key), value, o as never);
    return res === "OK" || res === (value as unknown) || (res !== null && res !== undefined);
  }
  async del(key: string) {
    await this.r.del(this.k(key));
  }
  async incr(key: string, by = 1) {
    return this.r.incrby(this.k(key), by);
  }
  async rpush(key: string, value: unknown) {
    return this.r.rpush(this.k(key), value);
  }
  async lpushTrim(key: string, value: unknown, max: number) {
    await this.r.lpush(this.k(key), value);
    await this.r.ltrim(this.k(key), 0, max - 1);
  }
  async lrange<T>(key: string, start: number, stop: number) {
    return (await this.r.lrange<T>(this.k(key), start, stop)) as T[];
  }
  async zadd(key: string, score: number, member: string) {
    await this.r.zadd(this.k(key), { score, member });
  }
  async zincr(key: string, member: string, by: number) {
    return Number(await this.r.zincrby(this.k(key), by, member));
  }
  async zrevrange(key: string, start: number, stop: number) {
    const raw = (await this.r.zrange(this.k(key), start, stop, { rev: true, withScores: true })) as (string | number)[];
    const rows: { member: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) rows.push({ member: String(raw[i]), score: Number(raw[i + 1]) });
    return rows;
  }
  async zrem(key: string, member: string) {
    await this.r.zrem(this.k(key), member);
  }
}

/** Plain Redis over TCP (e.g. Railway Redis via REDIS_URL). Values are JSON-encoded. */
class TcpRedisKV implements KV {
  kind = "redis" as const;
  constructor(private r: IORedis, private prefix: string) {}
  private k(key: string) {
    return this.prefix + key;
  }
  private enc(v: unknown) {
    return JSON.stringify(v);
  }
  private dec<T>(s: string | null): T | null {
    if (s === null || s === undefined) return null;
    try {
      return JSON.parse(s) as T;
    } catch {
      return s as unknown as T;
    }
  }
  async get<T>(key: string) {
    return this.dec<T>(await this.r.get(this.k(key)));
  }
  async set(key: string, value: unknown, opts?: { nx?: boolean; exSeconds?: number }) {
    const k = this.k(key);
    const v = this.enc(value);
    let res: string | null;
    if (opts?.nx && opts?.exSeconds) res = await this.r.set(k, v, "EX", opts.exSeconds, "NX");
    else if (opts?.nx) res = await this.r.set(k, v, "NX");
    else if (opts?.exSeconds) res = await this.r.set(k, v, "EX", opts.exSeconds);
    else res = await this.r.set(k, v);
    return res === "OK";
  }
  async del(key: string) {
    await this.r.del(this.k(key));
  }
  async incr(key: string, by = 1) {
    return this.r.incrby(this.k(key), by);
  }
  async rpush(key: string, value: unknown) {
    return this.r.rpush(this.k(key), this.enc(value));
  }
  async lpushTrim(key: string, value: unknown, max: number) {
    await this.r.multi().lpush(this.k(key), this.enc(value)).ltrim(this.k(key), 0, max - 1).exec();
  }
  async lrange<T>(key: string, start: number, stop: number) {
    return (await this.r.lrange(this.k(key), start, stop)).map((s) => this.dec<T>(s) as T);
  }
  async zadd(key: string, score: number, member: string) {
    await this.r.zadd(this.k(key), score, member);
  }
  async zincr(key: string, member: string, by: number) {
    return Number(await this.r.zincrby(this.k(key), by, member));
  }
  async zrevrange(key: string, start: number, stop: number) {
    const raw = await this.r.zrevrange(this.k(key), start, stop, "WITHSCORES");
    const rows: { member: string; score: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) rows.push({ member: raw[i], score: Number(raw[i + 1]) });
    return rows;
  }
  async zrem(key: string, member: string) {
    await this.r.zrem(this.k(key), member);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __zkKV: KV | undefined;
}

export function kv(): KV {
  if (globalThis.__zkKV) return globalThis.__zkKV;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const tcp = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
  const prefix = `zk:${process.env.ZECKED_NETWORK || "sim"}:`;
  if (tcp) {
    // Auto-pipelining: commands issued in the same tick (e.g. a Promise.all) share one round trip.
    const client = new IORedis(tcp, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false, connectTimeout: 8000, family: 0, enableAutoPipelining: true });
    client.on("error", (e) => console.error("redis error", e.message));
    globalThis.__zkKV = instrument(new TcpRedisKV(client, prefix));
  } else {
    globalThis.__zkKV = instrument(url && token ? new RedisKV(new Redis({ url, token }), prefix) : new MemoryKV());
  }
  return globalThis.__zkKV;
}
