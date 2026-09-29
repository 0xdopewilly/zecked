import { test } from "node:test";
import assert from "node:assert/strict";
import { attribute, type ReceivedNote } from "../src/vault.ts";

const A = "utest1useraaaa"; // user A's deposit address
const B = "utest1userbbbb"; // user B's deposit address
const DEFAULT = "utest1default"; // wallet address 0, not assigned to anyone
const assigned = new Set([A, B]);
const userA = { address: A, addressIndex: 5, createdAt: "", updatedAt: "" };
const TIP = 1000;

function note(p: Partial<ReceivedNote>): ReceivedNote {
  return {
    pool: "ironwood", txid: "t1", output_index: 0, value: 100, status: "confirmed", block_height: 995,
    datetime: 1_790_000_000, scope: "External", spend_status: "unspent", memo: null, address_index: null, address: null, ...p,
  };
}

test("credits notes received at the user's address even with no memo", () => {
  const r = attribute([note({ address: A, address_index: 5, value: 12_500_000 })], userA, "ZU:a", assigned, TIP, 1);
  assert.equal(r.receivedZat, 12_500_000);
  assert.equal(r.confirmedZat, 12_500_000);
  assert.equal(r.pendingZat, 0);
  assert.equal(r.confirmations, 6);
  assert.deepEqual(r.txids, ["t1"]);
  assert.equal(r.transfers[0].matchedBy, "address");
  assert.equal(r.lastTxAt, new Date(1_790_000_000_000).toISOString());
});

test("matches by address_index when the encoding differs", () => {
  const r = attribute([note({ address: "utest1other-encoding", address_index: 5 })], userA, "ZU:a", assigned, TIP, 1);
  assert.equal(r.receivedZat, 100);
});

test("memo is a secondary match only for notes on unassigned addresses", () => {
  const notes = [
    note({ txid: "m1", address: DEFAULT, memo: "ZU:a" }), // counts for A (memo, unassigned address)
    note({ txid: "m2", address: B, memo: "ZU:a" }), // paid to B's address: B's, never A's
    note({ txid: "m3", address: null, memo: "ZU:a thanks" }), // unknown address + tag + text: counts
    note({ txid: "m4", address: DEFAULT, memo: "ZU:ab" }), // different user id
  ];
  const r = attribute(notes, userA, "ZU:a", assigned, TIP, 1);
  assert.deepEqual(r.txids.sort(), ["m1", "m3"]);
  assert.ok(r.transfers.every((t) => t.matchedBy === "memo"));
});

test("change, failed and calculated notes never count; mempool is pending", () => {
  const notes = [
    note({ txid: "c", address: A, scope: "Internal" }),
    note({ txid: "f", address: A, status: "failed" }),
    note({ txid: "k", address: A, status: "calculated" }),
    note({ txid: "p", address: A, status: "mempool", block_height: 0, value: 7 }),
    note({ txid: "ok", address: A, value: 3 }),
  ];
  const r = attribute(notes, userA, "ZU:a", assigned, TIP, 1);
  assert.deepEqual(r.txids.sort(), ["ok", "p"]);
  assert.equal(r.receivedZat, 10);
  assert.equal(r.confirmedZat, 3);
  assert.equal(r.pendingZat, 7);
  assert.equal(r.confirmations, 0); // min across txs, mempool has 0
});

test("minConf moves young confirmed notes into pending; spent notes still count as received", () => {
  const notes = [
    note({ txid: "old", address: A, block_height: 900, value: 50, spend_status: "spent" }),
    note({ txid: "new", address: A, block_height: 999, value: 20 }),
  ];
  const r = attribute(notes, userA, "ZU:a", assigned, TIP, 3);
  assert.equal(r.receivedZat, 70);
  assert.equal(r.confirmedZat, 50);
  assert.equal(r.pendingZat, 20);
});

test("sums multiple notes of one tx once per note, across pools", () => {
  const notes = [
    note({ txid: "x", output_index: 0, pool: "ironwood", address: A, value: 1 }),
    note({ txid: "x", output_index: 1, pool: "sapling", address: A, value: 2 }),
    note({ txid: "x", output_index: 1, pool: "sapling", address: A, value: 2 }), // duplicate row ignored
  ];
  const r = attribute(notes, userA, "ZU:a", assigned, TIP, 1);
  assert.equal(r.receivedZat, 3);
  assert.deepEqual(r.transfers[0].pools, ["ironwood", "sapling"]);
});

test("memo-only lookup (no record) works for stashes funded before they had an address", () => {
  const r = attribute([note({ address: DEFAULT, memo: "ZK:s1" })], undefined, "ZK:s1", assigned, TIP, 1);
  assert.equal(r.receivedZat, 100);
});
