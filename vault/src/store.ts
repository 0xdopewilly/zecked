// Tiny JSON-file store kept in the wallet data dir (mode 600). Writes go to a
// temp file first and are renamed into place, so a crash never leaves a
// half-written file.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface StashRecord {
  stashId: string;
  address: string;
  amountZat: number;
  createdAt: string;
  updatedAt: string;
}

export type PayoutState = "sending" | "sent" | "failed";

export interface PayoutRecord {
  stashId: string;
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
  payouts: Record<string, PayoutRecord>;
}

export class Store {
  private readonly path: string;
  private state: VaultState;

  constructor(dataDir: string) {
    this.path = join(dataDir, "vault-state.json");
    this.state = existsSync(this.path)
      ? (JSON.parse(readFileSync(this.path, "utf8")) as VaultState)
      : { stashes: {}, payouts: {} };
    this.state.stashes ??= {};
    this.state.payouts ??= {};
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

  getPayout(id: string): PayoutRecord | undefined {
    return this.state.payouts[id];
  }

  putPayout(rec: PayoutRecord): void {
    this.state.payouts[rec.stashId] = rec;
    this.flush();
  }
}
