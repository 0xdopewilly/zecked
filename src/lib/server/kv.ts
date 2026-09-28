// Tiny key-value layer. Uses Upstash Redis when configured (production / Vercel),
// otherwise an in-process memory store (local dev, single-instance demos).
import { Redis } from "@upstash/redis";

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

declare global {
  // eslint-disable-next-line no-var
  var __zkKV: KV | undefined;
}

export function kv(): KV {
  if (globalThis.__zkKV) return globalThis.__zkKV;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  const prefix = `zk:${process.env.ZECKED_NETWORK || "sim"}:`;
  globalThis.__zkKV = url && token ? new RedisKV(new Redis({ url, token }), prefix) : new MemoryKV();
  return globalThis.__zkKV;
}
