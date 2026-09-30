# ZECKED 🔐

**Hide it. Crack it. Get Zecked.**

ZECKED is a free-to-play social game on [Zcash](https://z.cash). Anyone can hide a little ZEC behind a challenge. The first person to beat it wins the ZEC, and it lands in their private wallet.

- **Riddle stashes:** the first person to type the right answer takes it.
- **Prediction stashes:** call a real football match (exact score or winner) before kickoff. Calls stay sealed until then. At full time the first correct call takes it, with results coming in automatically from a live sports feed.

Players never pay to play; the hider puts up the prize. Winners stay anonymous, because payouts are shielded.

> **Status: test mode.** Play ZEC only. The Zcash engine runs in `sim` (simulated) or `testnet` mode. Mainnet is switched off until a security review is done.

## Stack
| Part | What | Where |
|---|---|---|
| App | Next.js 16 (App Router) + React 19, ported 1:1 from the Claude Design handoff (tokens, components, motion) | `src/app`, `src/components` |
| Game server | Stash lifecycle, rate-limited riddle guesses, sealed calls, first-correct-wins, XP / tiers / badges, leaderboards, ticker | `src/lib/server/game.ts`, `players.ts` |
| Storage | Upstash Redis (`KV_REST_API_URL` / `UPSTASH_REDIS_REST_URL`), falling back to an in-memory store | `src/lib/server/kv.ts` |
| Sports feed | Live fixtures and results (ESPN public scoreboard), plus quick demo matches in local sim mode | `src/lib/server/sports.ts` |
| Zcash engine | `sim`, or the `vault` HTTP service holding a testnet hot wallet (ZIP-321 funding with `ZK:<id>` memos, shielded payouts) | `src/lib/zcash/engine.ts`, `vault/` |
| Share cards | 1200×630 OG images for X and Telegram | `src/app/s/[id]/opengraph-image.tsx` |

## Run locally
```bash
npm install
npm run dev          # http://localhost:3100
```
Sim mode (local dev only) seeds a feed on first boot: riddles, real upcoming matches, and a demo match that kicks off every 8 minutes and plays out in about 6.

## Environment
| Var | Default | Purpose |
|---|---|---|
| `ZECKED_NETWORK` | `sim` | `sim` \| `testnet` \| `mainnet` |
| `VAULT_URL`, `VAULT_TOKEN` | none | Vault service, required for `testnet` / `mainnet` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | none | Upstash Redis (persistent storage) |
| `ZECKED_MAX_USD` / `ZECKED_MIN_USD` | `100` / `1` | Stash size limits |
| `NEXT_PUBLIC_SITE_URL` | none | Canonical URL for share links |

## Game rules (v1)
- Free to enter. Hiders fund prizes, and nobody pays to play.
- Riddles: 3 tries per player per 10 minutes. Answers are normalized (case, punctuation, and a leading "a", "an" or "the"). Hiders can accept alternatives with `|`.
- Predictions lock at kickoff. The earliest correct call wins. Postponed or abandoned matches return the stash to the hider.
- Uncracked stashes return to the hider (an "Uncrackable" badge). Winners have 7 days to claim.
- Stash sizes are capped (default $100) while ZECKED custodies funds between funding and payout.

See `docs/PRODUCT.md` and `docs/DESIGN-REVIEW.md`.
