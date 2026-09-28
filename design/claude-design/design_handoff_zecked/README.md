# Handoff: ZECKED mobile app

## Overview
ZECKED is a free-to-play social game built on Zcash. Players hide small ZEC prizes ("stashes") behind a **riddle** or a **football prediction**. The first person to crack the riddle, or the first person to call the match right, wins the ZEC into a private wallet. This bundle covers the full mobile flow (welcome → feed → crack/predict → win → claim), the 4-step hide flow, profile, leaderboard, two 1200×675 share cards for X, and a style guide with tokens, component states and motion specs.

## About the design files
The files here are **design references built in HTML**. They show the intended look and behaviour. They are not production code to ship. Rebuild them in the target codebase using its own framework and patterns (React Native, SwiftUI, Flutter, etc.). If there is no codebase yet, pick the framework that suits the product best.

To view: open `Zecked.dc.html` (the full canvas) or any single screen file in a browser, with `support.js` and `zk-tokens.css` in the same folder.

## Fidelity
**High fidelity.** Colors, type, spacing, radii, shadows, copy and interactions are final. Match them closely, using the tokens in `zk-tokens.css`.

## Design tokens
Everything visual is a CSS custom property in **`zk-tokens.css`**. Screens and components use only `var(--zk-*)` values. The only raw hex values left outside that file are sample team colors in mock data, and those are tokenised too (`--zk-team-*`).

- **Color:** surfaces `--zk-bg #0E0B1F`, `--zk-surface #1A1533`, `--zk-surface-raised #251E47`. Brand `--zk-gold #F4B728` (money, primary CTA, wins). Accents `--zk-purple #7C5CFF`, `--zk-pink #FF4D9A`, `--zk-mint #2EE6A6` (live + success), `--zk-sky #3DB8FF`, `--zk-red #FF5A5A` (wrong). Text `--zk-text #FFF`, `--zk-text-muted #A9A3C9`, `--zk-text-faint #6E6892`. Each accent has `-light / -deep / -ink` steps. `-deep` is the 3D bottom edge, `-ink` is the text color on that fill.
- **Alpha:** use RGB triplets, e.g. `rgb(var(--zk-gold-rgb) / .35)`. Ready-made tints: `--zk-*-tint`.
- **Gradients:** `--zk-grad-gold`, `--zk-grad-tile-*`, `--zk-grad-progress(-urgent/-calm)`, `--zk-grad-tension`, `--zk-grad-xp`, plus per-screen backgrounds `--zk-bg-*`.
- **Tier and badge palettes:** `--zk-tier-{rookie|cracker|safecracker|vault|oracle|legend|locked}-{hi|mid|lo|edge|ink|glow}` and `--zk-badge-{id|locked}-{hi|mid|lo|edge|ray}`.
- **Typography:** families `--zk-font-display` (Bricolage Grotesque 800), `--zk-font-body` (Inter 500–800), `--zk-font-mono` (Space Mono 700). Size scale `--zk-fs-10 … --zk-fs-92`. Composite styles `--zk-type-*` (use as `font: var(--zk-type-h1)`): hero 52, h1 34, riddle 30, h2 26, h3 20, h4 16, score 52/64, amount-xl 84, btn-lg 22 / md 18 / sm 14, body-lg 16, body 14, small 13, caption 12, label 11 (uppercase, 0.12em tracking), mono-xl 34 … mono-xs 11.
- **Spacing:** `--zk-space-2 … --zk-space-64` (px-named). Screen side padding is `--zk-screen-pad` (18px).
- **Radii:** xs 4, sm 8, md 12, lg 16, xl 20, 2xl 24, 3xl 28, 4xl 36, phone 52, pill 999.
- **Sizes:** buttons lg 62 / md 52 / sm 40, inputs 62 / 54 / 50, chips 38 / 32, minimum tap target 44, tab bar 90, status bar 50.
- **Shadows:** all buttons and tiles are "3D": a solid offset shadow in the `-deep` color (`--zk-shadow-btn-*`), which shrinks to 2px when pressed (`-pressed`). Cards use `--zk-shadow-card`, floating UI uses `--zk-shadow-float`, focus/error/success rings use `--zk-ring-*`, glows use `--zk-glow-*`.
- **Motion:** `--zk-dur-*` and `--zk-ease-out / -in-out / -spring`. Keyframes `zk-*` are defined in the same file.

## Screens
All screens are 390×844 (iPhone). Each file has one root `<section id>` that matches the screen list. Every phone frame is a flex column: `ZK Device Chrome` (status bar + home indicator, absolutely positioned), then content with `padding-top: statusbar + 6–10px` and screen padding, then a CTA pinned to the bottom with `margin-top:auto`, then the tab bar where there is one.

| File | Section ids | Purpose |
|---|---|---|
| 01-welcome | `01-welcome` | Vault door loop (`ZK Vault mode=loop`), floating stickers, wordmark, tagline, "Start zecking", "Free to play · No sign-up needed", "Built on Zcash". |
| 02-home-feed | `02-home-feed` | Header (wordmark, streak, balance), live ticker marquee, filter chips (All · Riddles · Predictions · Ending soon · Biggest; these filter and sort the feed), scrolling `ZK Stash Card` list, floating "Hide a stash" button, `ZK Tab Bar active=home`. |
| 03-riddle-stash | `03-riddle-stash` | Hider row (tier emblem), prize, riddle card with "Live · verified by viewing key" and a ⓘ tooltip ("Anyone can check this stash is real. Nobody can touch it."), `ZK Input`, "ZECK IT", 3 try-dots ("3 tries left (resets in 10 min)"), locked bonus hint with countdown, ghost share button. |
| 04-wrong-answer | `04-wrong-answer` | Static error state: "Nope!", "2 tries left", "Bold guess. Wrong, but bold 😏", input in error state with strike-through and shake, privacy toast. |
| 05-prediction-stash | `05-prediction-stash` | Match card (team badges, competition, kickoff, "Calls lock in" pill countdown), exact-score steppers 0–9, "LOCK MY CALL" (turns into a mint "CALL SEALED 2–1"), rule chips, "142 calls sealed 🔒. Revealed at kickoff." |
| 06-live-match | `06-live-match` | Solid live badge with the match minute, live score, match-time bar, goal events, your call and prize, tension meter (pointer springs along a gradient), "Still in the running" list. |
| 07-win | `07-win` | Spinning sunburst, open vault (`mode=open`), confetti, "YOU ZECKED IT!" pop, ZEC/USD count-up, "Badge unlocked: First Crack", XP bar filling, "Claim my ZEC". |
| 08-claim | `08a-claim-choose`, `08b-claim-delivered`, `08c-hider-notification` | (a) Radio cards "I have a Zcash wallet" (address input + Paste) and "Get a wallet in 60 seconds" (3 steps). "Send it to me" stays disabled until an address is entered. (b) Shielded badge, "It's in your private wallet.", "Nobody can see who won 🥷", receipt, victory-message input, share. (c) Lock-screen push: "Your stash just got ZECKED 🔓 by a mystery cracker". |
| 09-hide-a-stash | `09-1-type`, `09-2a-riddle`, `09-2b-prediction`, `09-3-amount`, `09-4a-fund`, `09-4b-live` | Step 1: pick Riddle or Prediction. Step 2a: riddle + answer + strength meter (Weak → Uncrackable). Step 2b: match list + Exact score / Winner. Step 3: amount slider ($1–$200) with presets $5 / $10 / $20 / Custom and expiry chips. Step 4a: QR, exact amount, address copy, waiting → detected. Step 4b: "Your stash is LIVE 🎉", share card preview, X / Telegram / copy link. |
| 10-profile | `10-profile` | Avatar, handle, tier card (emblem, XP bar), 5 stats (Cracked 14 · Hidden 6 · Uncrackable 2 · Oracle 1 · Streak 5🔥), badge grid (4 unlocked, 3 locked). |
| 11-leaderboard | `11-leaderboard` | Tabs Crackers / Hiders / Oracles, periods Today / Week / All-time, podium with crown on #1, ranks 4–8, a pinned "You · #47" bar. |
| 12-share-card | `12a-share-riddle`, `12b-share-prediction` | 1200×675 X cards. Copy: "Crack my riddle and ZECK 0.02 ZEC 🔐 First one wins." and "First to call BAR vs CHE exactly ZECKS $20 ⚽", with zecked.com/s/k7Q2. |
| style-guide | `style-guide` | Live token swatches, type scale, spacing, radii, shadows, logo, icon set, tiers, badges, every component state, and the motion spec table. |

## Components (all states)
| Component | Props | States |
|---|---|---|
| `ZK Button` | label, variant `primary/secondary/success/sky/light/ghost`, size `lg/md/sm`, icon, iconRight, full, onClick | default · hover (−1px lift, bigger shadow) · pressed (moves down 4px, shadow 2px) · disabled (raised surface, faint text, no shadow) |
| `ZK Chip` | label, active, variant `filter/info`, size `md/sm`, icon, onClick | default · hover · pressed · active (gold) · active-pressed · disabled (40% opacity) |
| `ZK Input` | value, placeholder, label, message, state, size, font `body/mono/display`, multiline, trailing, strike, shake, shakeLoop | default · focus (2px purple + ring) · error (red tint, red border, ✕) · success (mint border, ✓) · disabled (45% opacity) |
| `ZK Live Badge` | label, size `sm/md/lg`, variant `soft/solid`, state `live/ended` | live soft (pulsing dot) · live solid (blinking dot, used for match minute) · ended |
| `ZK Countdown` | seconds, live, format `hms/ms`, text, variant `inline/pill/boxed`, tone `default/urgent/gold/muted`, size | Ticks every second. Switch to `urgent` under 30 min. |
| `ZK Toast` | text, meta, icon, variant `default/success/error/gold` | Four variants. |
| `ZK Stash Card` | type `riddle/prediction`, content props, whale, urgent, state | default · hover · pressed · cracked (dimmed, "ZECKED" stamp, ended badge) · whale sticker · urgent time bar |
| `ZK Emblem` | tier, size, locked | 6 tiers, unlocked and locked |
| `ZK Badge` | badge, size, locked | 7 badges, unlocked (glossy + sunburst) and locked (grey + lock) |
| `ZK Team Badge` | code, color, ink, size | Colored circle and 3-letter code. Never club crests. |
| `ZK Logo` | variant `wordmark/icon/mark`, size | SVG Z mark (bolt + vault-handle hub) plus "ECKED" as live text |
| `ZK Icon` | icon, size, stroke, color, filled | 46 icons on a 24px grid with 2px round strokes, drawn as a single SVG path in `currentColor` |
| `ZK Vault` | mode `closed/loop/open/spin`, size | Illustration used on Welcome, Win and in the style guide |
| `ZK Count Up` | from, to, decimals, prefix, suffix, grouping, duration, loop, run | Owns its own requestAnimationFrame loop, so only the number re-renders |
| `ZK Confetti` | count, seed, size, run | Particle layer built once per `run`; each piece is CSS-animated |
| `ZK Device Chrome`, `ZK Tab Bar` | time / active, onSelect | Mock-only chrome, plus the app's 4-tab bar (Home · Leaderboard · Hide · Profile) |

## Interactions & behaviour
- **Riddle answer:** trim, lowercase, strip a leading "a/an/the", then compare. On a wrong answer: tries − 1, input goes to error state, shake plays, and the verdict line shows "Nope! Try again 😏". Tries reset 10 min after the first miss. At 0 tries the button is disabled. On a correct answer, go to the Win screen.
- **Prediction:** steppers clamp 0–9. Locking seals the call (read-only, mint button) and increments the sealed count. Calls lock at kickoff. The result comes from a live sports feed at full time, and the first correct call wins.
- **Tension meter:** 0–100 closeness score. The pointer animates with `--zk-ease-spring` over `--zk-dur-meter`.
- **Claim:** "Send it to me" is disabled until a valid shielded address (u1… / zs…) is entered, or the user picks the new-wallet path.
- **Hide flow:** riddle strength is a 0–4 score (in the prototype: riddle length ÷ 40, plus answer length bonuses; replace with a real heuristic). The "Next" button is disabled while the riddle or answer is empty. The amount slider maps $1–$200 to ZEC at the live rate (prototype uses $1,500/ZEC). Funding polls for the payment, and the status goes from spinner to ✓.
- **Always show amounts as ZEC · ~USD**, e.g. "0.02 ZEC · ~$30".
- **Copy rules:** use crack, call it, predict, hide, stash, vault. Never bet, odds or wager. No casino imagery.

## State (per screen)
Home: `chip`. Riddle: `answer, tries, verdict, shakeCount, tooltipOpen`. Prediction: `home, away, locked`. Live: `score, minute` (from the feed). Win: count-up progress. Claim: `method, address, message`. Hide: `type, riddle, answer, matchId, predictionType, usd, preset, expiry, paid`. Leaderboard: `tab, period`.

## Motion
The full table is in the style guide (`#sg-motion`). Keyframes are in `zk-tokens.css`.
| Animation | Keyframes | Duration | Easing | Notes |
|---|---|---|---|---|
| Confetti | `zk-fall` | 2.4–4.6s per piece | linear | 70 pieces, 6 brand colors, 6–14px, negative delays; stop spawning after about 3s |
| Vault spin + open | `zk-dial`, `zk-door` | 6000ms cycle | cubic-bezier(.65,0,.35,1) | Dial turns 540° in the first 30%, door rotateY −112° (hinge on the left, perspective 1000px) |
| Wrong-answer shake | `zk-shake-a/-b` | 450ms | cubic-bezier(.65,0,.35,1) | ±10px twice, alternate names to retrigger; error haptic |
| LIVE pulse | `zk-ping` | 1600ms, infinite | ease-out | Mint ring grows 0 → 7px and fades |
| Ticker | `zk-marquee` | 26s per loop | linear | Content duplicated, translateX 0 → −50%, pause on touch |
| Count-up | requestAnimationFrame | 1800ms | 1 − (1 − t)³ | ZEC to 4 decimals, USD to 2; the title pops in with `zk-pop` (700ms, cubic-bezier(.3,1.6,.5,1)) |
Respect `prefers-reduced-motion`: replace loops with a single fade and show final numbers straight away.

## Assets
- All icons, the logo, tier emblems, badges, the vault illustration and the QR placeholder are inline SVG. There are no image files.
- The fonts are Google Fonts (Bricolage Grotesque, Inter, Space Mono), loaded with a `<link>` in each page head.
- Emoji appear only inside copy strings from the brief (e.g. "Nobody can see who won 🥷"). No emoji are used as UI icons.
- Team colors are sample data. In production they come from the sports feed. Never use club crests or the official Zcash logo.
- The QR code on 09.4a is decorative. Generate a real ZIP-321 payment URI QR in production.

## Files
- `zk-tokens.css`: all design tokens and keyframes
- `Zecked.dc.html`: overview canvas that imports every screen
- `01-welcome` … `12-share-card`, `style-guide` (`.dc.html`): one file per screen
- `ZK *.dc.html`: reusable components
- `support.js`: runtime needed to open the `.dc.html` files in a browser
