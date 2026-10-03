// Passkeys (WebAuthn): Face ID, fingerprint or the phone's screen lock. Nothing to type and nothing to
// leak: we only ever store a public key. Credentials are discoverable ("resident"), so signing in needs
// no username. Apple and Google sync them across the user's devices.
import { randomBytes } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { adoptGuest } from "./auth";
import { kv } from "./kv";
import { getPlayer, isAccount, savePlayer, type PlayerRecord } from "./players";
import { HttpError, nowIso } from "./util";

const CHALLENGE_TTL = 5 * 60;

type StoredPasskey = { pid: string; publicKey: string; counter: number; transports?: string[]; backedUp?: boolean; createdAt: string };

/** Relying party = the host the app is served from. With ZECKED_RP_ID=zecked.com, passkeys belong to
 *  zecked.com itself, so they work on app.zecked.com and any other zecked.com address. Other hosts (an
 *  old vercel.app address, previews, localhost) keep their own. ZECKED_ORIGIN overrides the origin. */
export function relyingParty(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  const hostname = host.split(":")[0];
  const root = process.env.ZECKED_RP_ID;
  const rpID = root && (hostname === root || hostname.endsWith(`.${root}`)) ? root : hostname;
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "") || "https";
  return { rpID, origin: process.env.ZECKED_ORIGIN || `${proto}://${host}` };
}
type RP = ReturnType<typeof relyingParty>;

async function passkeyIds(pid: string) {
  return kv().lrange<string>(`pks:${pid}`, 0, 49);
}

export async function passkeyRegisterOptions(p: PlayerRecord, sid: string, rp: RP) {
  if (!p.passkeyUser) {
    p.passkeyUser = randomBytes(32).toString("base64url");
    await savePlayer(p);
  }
  const existing = await passkeyIds(p.id);
  const options = await generateRegistrationOptions({
    rpName: "ZECKED",
    rpID: rp.rpID,
    userName: `@${p.handle}`,
    userDisplayName: `ZECKED · @${p.handle}`,
    userID: new Uint8Array(Buffer.from(p.passkeyUser, "base64url")),
    attestationType: "none",
    excludeCredentials: existing.map((id) => ({ id })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    supportedAlgorithmIDs: [-7, -257],
  });
  await kv().set(`wa:reg:${sid}`, { challenge: options.challenge, pid: p.id }, { exSeconds: CHALLENGE_TTL });
  return options;
}

/** Saves the new passkey on the current player. A guest becomes an account right here. */
export async function passkeyRegisterVerify(p: PlayerRecord, sid: string, rp: RP, response: RegistrationResponseJSON) {
  const pending = await kv().get<{ challenge: string; pid: string }>(`wa:reg:${sid}`);
  await kv().del(`wa:reg:${sid}`);
  if (!pending || pending.pid !== p.id) throw new HttpError(400, "That took a while. Tap the button again");
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    console.error("passkey register verify", e);
    throw new HttpError(400, "Couldn't create the passkey. Try again");
  }
  if (!verified.verified) throw new HttpError(400, "Couldn't create the passkey. Try again");
  const { credential, credentialBackedUp } = verified.registrationInfo;
  if (await kv().get(`pk:${credential.id}`)) throw new HttpError(409, "That passkey is already set up. Use “I already have a passkey”");
  const stored: StoredPasskey = {
    pid: p.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports,
    backedUp: credentialBackedUp,
    createdAt: nowIso(),
  };
  await kv().set(`pk:${credential.id}`, stored);
  await kv().rpush(`pks:${p.id}`, credential.id);
  const isNew = !isAccount(p);
  p.passkeys = (p.passkeys ?? 0) + 1;
  p.verifiedAt = p.verifiedAt || nowIso();
  await savePlayer(p);
  return { player: p, isNew };
}

export async function passkeyLoginOptions(sid: string, rp: RP) {
  // No allowCredentials: the device offers whichever ZECKED passkey it holds.
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "preferred" });
  await kv().set(`wa:auth:${sid}`, { challenge: options.challenge }, { exSeconds: CHALLENGE_TTL });
  return options;
}

export async function passkeyLoginVerify(guest: PlayerRecord, sid: string, rp: RP, response: AuthenticationResponseJSON) {
  const pending = await kv().get<{ challenge: string }>(`wa:auth:${sid}`);
  await kv().del(`wa:auth:${sid}`);
  if (!pending) throw new HttpError(400, "That took a while. Tap the button again");
  const stored = await kv().get<StoredPasskey>(`pk:${response.id}`);
  if (!stored) throw new HttpError(404, "We don't know that passkey yet. Tap “Sign up with a passkey” to create your account");
  let verified;
  try {
    verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: { id: response.id, publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")), counter: stored.counter, transports: stored.transports },
      requireUserVerification: false,
    });
  } catch (e) {
    console.error("passkey login verify", e);
    throw new HttpError(401, "That passkey didn't check out. Try again");
  }
  if (!verified.verified) throw new HttpError(401, "That passkey didn't check out. Try again");
  stored.counter = verified.authenticationInfo.newCounter;
  await kv().set(`pk:${response.id}`, stored);
  const account = await getPlayer(stored.pid);
  if (!account) throw new HttpError(404, "That account is gone");
  adoptGuest(account, guest);
  await savePlayer(account);
  return { player: account, isNew: false };
}
