// ZIP-321 payment request URIs: https://zips.z.cash/zip-0321
//
//   zcash:<address>?amount=<decimal ZEC>&memo=<base64url(memo bytes), no padding>

const ZAT_PER_ZEC = 100_000_000n;
/** 21M ZEC, the most any amount can be. */
export const MAX_MONEY_ZAT = 21_000_000n * ZAT_PER_ZEC;

/** Formats zatoshis as a ZIP-321 decimal ZEC amount ("0.125", "1", "0.00000001"). */
export function zatToZec(zat: number | bigint): string {
  const z = BigInt(zat);
  if (z < 0n || z > MAX_MONEY_ZAT) throw new RangeError(`amount out of range: ${z}`);
  const whole = z / ZAT_PER_ZEC;
  const frac = (z % ZAT_PER_ZEC).toString().padStart(8, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** Parses a ZIP-321 decimal ZEC amount back into zatoshis. */
export function zecToZat(zec: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(zec);
  if (!m) throw new Error(`invalid ZIP-321 amount: ${zec}`);
  return BigInt(m[1]) * ZAT_PER_ZEC + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
}

/** base64url (RFC 4648 section 5) of the UTF-8 memo text, without "=" padding, as ZIP-321 requires. */
export function encodeMemo(text: string): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > 512) throw new RangeError("memo exceeds 512 bytes");
  return bytes.toString("base64url").replace(/=+$/, "");
}

export function decodeMemo(b64url: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(b64url)) throw new Error("memo is not base64url");
  return Buffer.from(b64url, "base64url").toString("utf8");
}

export interface PaymentRequest {
  address: string;
  amountZat?: bigint;
  memo?: string;
}

export function buildPaymentUri(req: PaymentRequest): string {
  const params: string[] = [];
  if (req.amountZat !== undefined) params.push(`amount=${zatToZec(req.amountZat)}`);
  if (req.memo !== undefined) params.push(`memo=${encodeMemo(req.memo)}`);
  return `zcash:${req.address}${params.length ? `?${params.join("&")}` : ""}`;
}

/** Minimal single-payment parser, used to self-check generated URIs. */
export function parsePaymentUri(uri: string): PaymentRequest {
  const m = /^zcash:([^?]*)(?:\?(.*))?$/.exec(uri);
  if (!m) throw new Error("not a zcash: URI");
  const out: PaymentRequest = { address: m[1] };
  for (const part of (m[2] ?? "").split("&").filter(Boolean)) {
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : part.slice(eq + 1);
    if (key === "address") out.address = value;
    else if (key === "amount") out.amountZat = zecToZat(value);
    else if (key === "memo") out.memo = decodeMemo(value);
  }
  return out;
}
