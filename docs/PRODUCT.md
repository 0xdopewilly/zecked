# ZECKED: Product Spec (v1)

## The loop
1. **Hide.** A player writes a challenge, picks an amount and an expiry, and funds the stash from their own Zcash wallet.
   - *Challenge a friend:* a switch on the prize step, "Only people with the link can see this", makes the stash link-only: never in the feed, the ticker or the hider's public profile (it still shows in My stashes), but anyone with the link can crack it and the crack counts fully for their stats.
2. **Share.** Every stash gets a link and a share card for X and Telegram.
3. **Crack.** Anyone can play without an account. The first correct answer or call wins.
4. **Claim.** The winner picks a destination: their own Zcash wallet, or a 60-second wallet setup. The ZEC arrives shielded.
5. **Repeat.** The next screen says "Hide your own stash."

## Stash types
| Type | Win condition | Resolves |
|---|---|---|
| Riddle | First exact answer (normalized: case, spacing, punctuation) | Instantly, on the correct answer |
| Prediction: exact score | First player whose call matches the final score | At full time, from the live results feed |
| Prediction: winner / draw | First player who called the right outcome | At full time, from the live results feed |

- Predictions **lock at kickoff** and stay **sealed** (hidden from other players) until then.
- "First" means the earliest submission timestamp recorded by the server.
- Riddle guesses are **rate-limited** per player and per stash, so bots can't try every word.
- If nobody wins before expiry, the stash **goes back to the hider**, who earns an "Uncrackable" badge.
- If a match is postponed or abandoned, the stash goes back to the hider.

## Where Zcash comes in
| Feature | Use |
|---|---|
| Shielded payments | Winners receive privately. Nobody can see who won |
| Viewing keys | The "LIVE · verified" badge: anyone can check a stash is funded and unclaimed |
| Encrypted memos | The hider's taunt or hint, and the winner's victory message |
| ZIP-321 payment URIs | The "Fund it" QR code, scannable from any Zcash wallet |

## Game layer
- **Tiers:** Rookie → Cracker → Safecracker → Vault Breaker → Oracle → Z-Legend (earned by XP)
- **Badges:** First Crack · Uncrackable · Oracle (3 exact scores) · Speed Demon (cracked in under 60s) · Whale Hider (stash over $100) · Shielded (first private wallet) · Birthday OG (played during Zcash's 10th birthday week)
- **Leaderboards:** Crackers / Hiders / Oracles × Today / Week / All-time
- **Juice:** confetti, vault-door animations, streaks, a live win ticker, share cards

## Tournament
- **What it is:** the Crackers › Week board, with prizes. The week runs Monday 00:00:00 to Sunday 23:59:59 UTC; most cracks wins, ties go to whoever got their last crack in first.
- **Prizes:** the top 3 get $5 / $3 / $2 of test ZEC from the house (`ZECKED_TOURNEY_USD`, default `5,3,2`; fewer entries = fewer paid places). Paid like invite rewards: a wallet credit, a "Weekly tournament 🏆" notice and a push. No XP, badges or ticker lines, so winners stay anonymous outside the board.
- **Accounts only:** a guest in the top 3 gets "Sign up to collect your $3 prize" and is paid the moment they sign up.
- **Settlement:** the first feed or `/api/tournament` read after Monday 00:00 UTC pays last week, exactly once (a per-week lock plus a per-player paid key). An empty house leaves the week "unpaid" and the next read retries after a top-up (budget ≈ $10 of test ZEC per week). Owner tools: `GET /api/admin/tournament?week=2026-41` and `POST /api/admin/tournament/settle?week=…`.
- **On the board:** a strip under the period row ("Week ends in 2d 4h · top 3 win $5 / $3 / $2 of test ZEC") and, once a week has settled, a "Last week's champions" row with avatars, handles and prizes. The house and seeded demo players never win.

## Ground rules (v1)
- **Free to enter.** Players never pay to play; the prize comes from the hider. There is no paid wagering in v1.
- **Custody:** Zcash has no smart contracts, so the ZECKED server holds each stash until it resolves and then pays the winner. Stash sizes are capped (initially $100). Longer term, split keys (FROST) so no single party can move funds.
- **No real club crests or official Zcash logo.** Teams appear as color badges with 3-letter codes, with "Built on Zcash" in text.
- **Results source** is shown on every prediction stash.

## Open questions
- [ ] Stash cap and minimum (network fee is about 0.0003 ZEC per payout)
- [ ] Sports results provider (API-Football / football-data.org / other) and league coverage
- [ ] Accounts: anonymous handle only, or optional X/Telegram login for leaderboards and anti-farming
- [ ] Legal review of custody and prediction contests before public launch
- [ ] License (MIT if we want Zcash community funding later)
