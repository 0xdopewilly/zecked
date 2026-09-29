// Minimal gRPC-over-HTTP/2 client for the two lightwalletd calls the vault
// needs directly: the chain tip (health / confirmations) and the server's
// chain name (to refuse anything that is not testnet). No protobuf library:
// the messages are tiny, so a hand-rolled decoder is enough.
import http2 from "node:http2";

const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer";

type Field = { num: number; wire: number; value: bigint | Buffer };

function readVarint(buf: Buffer, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("truncated varint");
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos];
    shift += 7n;
  }
}

function decodeFields(buf: Buffer): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos);
    pos = p1;
    const num = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [v, p2] = readVarint(buf, pos);
      fields.push({ num, wire, value: v });
      pos = p2;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      const end = p2 + Number(len);
      fields.push({ num, wire, value: buf.subarray(p2, end) });
      pos = end;
    } else if (wire === 1) {
      fields.push({ num, wire, value: buf.readBigUInt64LE(pos) });
      pos += 8;
    } else if (wire === 5) {
      fields.push({ num, wire, value: BigInt(buf.readUInt32LE(pos)) });
      pos += 4;
    } else {
      throw new Error(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

function unary(baseUrl: string, method: string, message: Buffer, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.includes("://") ? baseUrl : `https://${baseUrl}`);
    const session = http2.connect(url.origin);
    const timer = setTimeout(() => {
      session.destroy();
      reject(new Error(`lightwalletd ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const done = (err: Error | null, value?: Buffer) => {
      clearTimeout(timer);
      session.close();
      if (err) reject(err);
      else resolve(value as Buffer);
    };
    session.on("error", (e) => done(e));
    const req = session.request({
      ":method": "POST",
      ":path": `${SERVICE}/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
    });
    const chunks: Buffer[] = [];
    let status: string | undefined;
    let statusMessage: string | undefined;
    const takeStatus = (h: http2.IncomingHttpHeaders) => {
      if (h["grpc-status"] !== undefined) status = String(h["grpc-status"]);
      if (h["grpc-message"] !== undefined) statusMessage = decodeURIComponent(String(h["grpc-message"]));
    };
    req.on("response", takeStatus);
    req.on("trailers", takeStatus);
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("error", (e) => done(e));
    req.on("end", () => {
      if (status !== undefined && status !== "0") {
        return done(new Error(`lightwalletd ${method} failed: grpc-status ${status} ${statusMessage ?? ""}`));
      }
      const body = Buffer.concat(chunks);
      if (body.length < 5) return done(new Error(`lightwalletd ${method}: empty response`));
      const len = body.readUInt32BE(1);
      done(null, body.subarray(5, 5 + len));
    });
    const frame = Buffer.alloc(5 + message.length);
    frame.writeUInt8(0, 0);
    frame.writeUInt32BE(message.length, 1);
    message.copy(frame, 5);
    req.end(frame);
  });
}

/** GetLatestBlock(ChainSpec{}) -> BlockID { uint64 height = 1; bytes hash = 2; } */
export async function getLatestBlockHeight(baseUrl: string, timeoutMs = 15_000): Promise<number> {
  const fields = decodeFields(await unary(baseUrl, "GetLatestBlock", Buffer.alloc(0), timeoutMs));
  const height = fields.find((f) => f.num === 1 && f.wire === 0);
  if (!height) throw new Error("GetLatestBlock: no height in response");
  return Number(height.value);
}

export interface LightdInfo {
  version: string;
  vendor: string;
  chainName: string;
  blockHeight: number;
  consensusBranchId: string;
}

/** GetLightdInfo(Empty) -> LightdInfo (version=1, vendor=2, chainName=4, consensusBranchId=6, blockHeight=7). */
export async function getLightdInfo(baseUrl: string, timeoutMs = 15_000): Promise<LightdInfo> {
  const fields = decodeFields(await unary(baseUrl, "GetLightdInfo", Buffer.alloc(0), timeoutMs));
  const str = (n: number) => {
    const f = fields.find((x) => x.num === n && x.wire === 2);
    return f ? (f.value as Buffer).toString("utf8") : "";
  };
  const num = (n: number) => {
    const f = fields.find((x) => x.num === n && x.wire === 0);
    return f ? Number(f.value) : 0;
  };
  return {
    version: str(1),
    vendor: str(2),
    chainName: str(4),
    consensusBranchId: str(6),
    blockHeight: num(7),
  };
}
