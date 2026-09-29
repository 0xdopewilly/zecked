// Tiny JSON-file store kept in the wallet data dir (mode 600). Writes go to a
// temp file first and are renamed into place, so a crash never leaves a
// half-written file.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

/** A wallet address handed out for a stash or a user. */
export interface AddressRecord {
  address: string;
  /** zingo-cli's unified address index (from `new_address`), when known. */
  addressIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export interface StashRecord extends AddressRecord {
  stashId: string;
  amountZat: number;
}

export interface UserRecord extends AddressRecord {
  userId: string;
}

export type PayoutState = "sending" | "sent" | "failed";

export interface PayoutRecord {
  /** Idempotency key: the request's `key`, or the stashId when no key was given. */
  key: string;
  stashId?: string;
  to: string;
  amountZat: number;
  memo: string;
  state: PayoutState;
  txid?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface VaultState {
  stashes: Record<string, StashRecord>;
  users: Record<string, UserRecord>;
  payouts: Record<string, PayoutRecord>;
}

export class Store {
  private readonly path: string;
  private state: VaultState;

  constructor(dataDir: string) {
    this.path = join(dataDir, "vault-state.json");
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as VaultState)
      : { stashes: {}, users: {}, payouts: {} };
    this.state.stashes ??= {};
    this.state.users ??= {};
    this.state.payouts ??= {};
    // Records written before `key` existed were keyed by stashId.
    for (const [k, p] of Object.entries(this.state.payouts)) p.key ??= k;
  }

  private flush(): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  getStash(id: string): StashRecord | undefined {
    return this.state.stashes[id];
  }

  putStash(rec: StashRecord): void {
    this.state.stashes[rec.stashId] = rec;
    this.flush();
  }

  getUser(id: string): UserRecord | undefined {
    return this.state.users[id];
  }

  putUser(rec: UserRecord): void {
    this.state.users[rec.userId] = rec;
    this.flush();
  }

  /** Every address handed out to a stash or a user. */
  assignedAddresses(): Set<string> {
    const s = new Set<string>();
    for (const r of Object.values(this.state.stashes)) s.add(r.address);
    for (const r of Object.values(this.state.users)) s.add(r.address);
    return s;
  }

  getPayout(key: string): PayoutRecord | undefined {
    return this.state.payouts[key];
  }

  putPayout(rec: PayoutRecord): void {
    this.state.payouts[rec.key] = rec;
    this.flush();
  }
}
