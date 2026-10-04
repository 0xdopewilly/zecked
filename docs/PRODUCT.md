# ZECKED: Product Spec (v1)

## The loop
1. **Hide.** A player writes a challenge, picks an amount and an expiry, and funds the stash from their own Zcash wallet.
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

## Gifts
ZEC for one person, sent from the Wallet (**Gift 🎁**, next to Add ZEC and Withdraw) and opened from a link (`/g/<id>`).
- **Send.** Pick an amount ($0.50–$20, `ZECKED_GIFT_MIN_USD` / `_MAX_USD`), add a note (up to 140 characters), optionally **lock it with a question** (up to 80 characters) whose answer (up to 60, `|` separates alternatives) only they know. Check it over, send: the ZEC leaves the sender's in-app balance at once. Then share the link (WhatsApp, X, Telegram, the share sheet, copy).
- **Open.** The link shows who it's from, the amount and the note (the amount is visible before opening; the lock protects the ZEC, not the number). Locked gifts need the answer, normalized like riddle answers, 5 tries per 10 minutes per player; the answer is never revealed. The first correct opener wins, exactly once. Accounts are credited on the spot; guests see "Sign up to keep it" and the ZEC lands in their wallet on sign-up (same as wins).
- **Back to the sender.** Unopened after 7 days, or when the sender taps **Take it back**, the ZEC returns to the sender's wallet and the link stops working.
- **Quiet.** Gifts are not stashes: never in the feed, the ticker, the leaderboards or public profiles; no XP, badges or stats. The only places a gift shows are its own link, the sender's and opener's Wallet activity (rows open the gift), and a notice to the sender when it's opened. The link preview says "You've got a ZECKED gift" and who it's from, never the amount, note or question (chat apps fetch previews).
- **Caps.** 20 sends a day per sender, 50 opens a day per opener.

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
