# ZECKED 🔐

**Hide it. Crack it. Get Zecked.**

ZECKED is a free-to-play game on [Zcash](https://z.cash). You hide ZEC behind a riddle or a football match prediction and share the link. The first person to crack the riddle or call the score keeps the ZEC, paid out in **shielded** Zcash, so nobody can see who won.

- **Play:** https://app.zecked.com (Zcash **testnet**: test ZEC, not real money)
- **Website:** https://zecked.com

> **Status: testnet.** Zcash has no smart contracts, so the ZECKED server holds each stash between funding and payout. Mainnet stays switched off (`ZECKED_ALLOW_MAINNET`) until that custody has had a security review. The long-term plan is FROST threshold custody.

## How it plays
- **Riddle stashes:** the first exact answer wins. Answers are normalized for case, spacing, punctuation and a leading "a", "an" or "the", and hiders can accept alternatives with `|`. Each player gets 3 tries per stash every 10 minutes.
- **Prediction stashes:** call a real football match (exact score, or winner/draw) before kickoff. Calls stay sealed until kickoff, the earliest correct call wins, and results come from a live feed. Postponed or abandoned matches refund the hider.
- **Nobody pays to play.** The hider funds the prize. An uncracked stash goes back to the hider, who earns an "Uncrackable" badge.
- **The house (@zecked)** drops a free riddle every few hours and gives new accounts a small test-ZEC welcome gift. When a friend you invited signs up and plays, you get a small reward.

## Where Zcash comes in
| | |
|---|---|
| Shielded addresses | Every stash and every player gets its own unified address (Orchard/Ironwood + Sapling receivers, **no transparent receiver**) |
| Funding | ZIP-321 payment URIs: scan the QR code from any Zcash wallet, or fund from your in-app balance |
| Confirmation | A stash only goes live once the vault sees its ZEC arrive on-chain at the stash's own address |
| Payouts | Winners, refunds and withdrawals are shielded sends |

The wallet engine is [zingolib](https://github.com/zingolabs/zingolib) `zingo-cli` 6.0.0 (Ironwood / NU6.3), built with two small patches: one reports which of our addresses each note was received by, so deposits are credited per address; the other adds the NU7 testnet parameters (activation height 4,465,026, consensus branch `0x77190AD9`), so the vault keeps syncing through Zcash's next network upgrade, which went live on testnet on 2026-10-04. Details in [`vault/README.md`](vault/README.md) and [`vault/engine/nu7/README.md`](vault/engine/nu7/README.md).

## Architecture
```
Browser / installed PWA (Next.js 16, React 19)
        │  HTTPS
        ▼
App + API on Vercel ──── Redis (players, stashes, sessions, leaderboards)
        │  HTTPS + bearer token
        ▼
Vault service (Railway) ── zingo-cli ── lightwalletd (testnet.zec.rocks) ── Zcash testnet
```

| Part | Where |
|---|---|
| Screens (home feed, stash, hide flow, wallet, profile, leaderboard, install) | `src/components/screens` |
| Design system (tokens, dock, vault, cards, sounds) | `src/components/zk`, `src/styles` |
| Game server: stash lifecycle, guesses, sealed calls, first-correct-wins, XP / tiers / badges | `src/lib/server/game.ts`, `players.ts` |
| Sign-in: passkeys (WebAuthn), email codes (Resend), Google | `src/lib/server/passkeys.ts`, `auth.ts`, `google.ts` |
| House drops, welcome gift, invites | `src/lib/server/house.ts`, `invites.ts` |
| Notifications: in-app notices, web push | `src/lib/server/notify.ts`, `push.ts` |
| Live football results (ESPN public scoreboard) | `src/lib/server/sports.ts` |
| Link previews (1200×630 share cards) | `src/lib/server/og.tsx` |
| Service worker (offline app shell, per deployment) | `src/lib/sw-source.ts`, `src/app/sw.js` |
| Zcash testnet wallet service | `vault/` |

## Run locally
```bash
npm install
ZECKED_SURFACE=app npx next dev -p 3100     # http://localhost:3100
```
With no settings, the app runs in **sim** mode: ZEC is simulated, storage is in memory, a demo feed is seeded, and email codes are shown on screen. Set `ZECKED_HOUSE=on` to try house drops and gifts locally. `ZECKED_SURFACE=site` serves the marketing website instead.

## Settings
| Var | Purpose |
|---|---|
| `ZECKED_SURFACE` | `app` (default) or `site` (the marketing website) |
| `ZECKED_NETWORK` | `sim` (default), `testnet` or `mainnet` (also needs `ZECKED_ALLOW_MAINNET=yes`) |
| `VAULT_URL`, `VAULT_TOKEN` | The vault service (testnet) |
| `REDIS_URL` | Redis over TCP. `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work. Without either, storage is in memory |
| `ZECKED_SECRET` | Server secret for hashing sign-in codes |
| `ZECKED_RP_ID` | Passkey relying party (e.g. `zecked.com`, so passkeys work on every subdomain) |
| `RESEND_API_KEY`, `EMAIL_FROM` | Email sign-in codes |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Sign in with Google (callback: `<origin>/api/auth/google/callback`) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push |
| `ZECKED_ADMIN_TOKEN` | Owner endpoints (house status, forced drops, removing a profile photo) |
| `ZECKED_DROP_HOURS`, `ZECKED_GIFT_USD`, `ZECKED_INVITE_USD`, `ZECKED_MIN_USD`, `ZECKED_MAX_USD` | Game tuning |
| `ZECKED_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `ZECKED_CANONICAL` | Public addresses, and forwarding from old ones |

## Safety notes
- Testnet only, for now: the vault refuses non-testnet chains and addresses.
- The vault never exports the seed or viewing keys, and never logs raw wallet output.
- Stash sizes are capped (default $100).
- Riddle guesses are rate-limited and checked against salted hashes. The answer is only shown to players once a stash ends.
- Players are never shown each other's ids, and winners stay anonymous on public screens.

## License
[MIT](LICENSE) © 2026 Busari Ibraheem Ayoola. Built with open-source libraries including zingolib, Next.js, SimpleWebAuthn, web-push and qrcode.
