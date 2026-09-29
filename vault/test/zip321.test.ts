import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaymentUri, parsePaymentUri, zatToZec, zecToZat, encodeMemo, decodeMemo } from "../src/zip321.ts";
import { memoMatches, memoTag } from "../src/vault.ts";

test("zatToZec formats ZIP-321 decimal amounts", () => {
  assert.equal(zatToZec(12_500_000), "0.125");
  assert.equal(zatToZec(100_000_000), "1");
  assert.equal(zatToZec(1), "0.00000001");
  assert.equal(zatToZec(123_456_789_012), "1234.56789012");
  assert.equal(zatToZec(0), "0");
  assert.throws(() => zatToZec(-1));
});

test("zecToZat inverts zatToZec", () => {
  for (const z of [1n, 10n, 12_500_000n, 100_000_000n, 2_100_000_000_000_000n]) assert.equal(zecToZat(zatToZec(z)), z);
});

test("memo is base64url without padding", () => {
  // "ZK:abc" -> base64 "Wks6YWJj" (no padding needed); "ZK:ab" needs padding in std base64
  assert.equal(encodeMemo("ZK:abc"), "Wks6YWJj");
  assert.equal(encodeMemo("ZK:ab"), "Wks6YWI");
  assert.equal(encodeMemo("ZK:a?>"), "Wks6YT8-");
  assert.ok(!encodeMemo("ZK:x").includes("="));
  assert.equal(decodeMemo(encodeMemo("ZK:héllo_-")), "ZK:héllo_-");
});

test("buildPaymentUri round-trips", () => {
  const address = "utest1exampleaddress";
  const uri = buildPaymentUri({ address, amountZat: 12_500_000n, memo: "ZK:stash_1-A" });
  assert.equal(uri, `zcash:${address}?amount=0.125&memo=${Buffer.from("ZK:stash_1-A").toString("base64url")}`);
  assert.deepEqual(parsePaymentUri(uri), { address, amountZat: 12_500_000n, memo: "ZK:stash_1-A" });
});

test("memo attribution is exact", () => {
  const tag = memoTag("abc");
  assert.ok(memoMatches("ZK:abc", tag));
  assert.ok(memoMatches("  ZK:abc\n", tag));
  assert.ok(memoMatches("ZK:abc thanks!", tag));
  assert.ok(!memoMatches("ZK:abcd", tag));
  assert.ok(!memoMatches("xZK:abc", tag));
  assert.ok(!memoMatches("ZK:ab", tag));
});
