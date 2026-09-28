# Design Review: Claude Design handoff (2026-09-28)

Source: `design/claude-design/design_handoff_zecked/` (12 screens, 20 components, `zk-tokens.css`, motion spec). Rendered previews are in `design/previews/`.

**Verdict:** high fidelity and ready to build from. The tokens, component states, motion table and behaviour rules are all specified.

## Fix during build
- [ ] **02 Home:** long team names crowd the kickoff countdown on prediction cards. Truncate names or use 3-letter codes under ~360px.
- [ ] **05 Prediction:** the two score steppers are cramped at 390px (the separator is squeezed and the right "+" touches the card edge). Stack the steppers or shrink them.
- [ ] **07 Win:** the XP label wraps ("1,240 / 1,500 XP" breaks onto two lines), and the "Claim my ZEC" button sits on the home indicator. Add a safe-area bottom inset.
- [ ] **09.3 Amount:** the slider goes to $200, but the v1 cap is $100 (`docs/PRODUCT.md`). Align them.
- [ ] Emoji show as boxes in headless Linux renders only. That's the test environment, not the design. Real phones are fine.

## Missing screens and states (needed for a real product)
- [ ] **Too late:** you open a riddle someone already zecked ("Zecked 4m ago by a mystery cracker"), with a link to similar stashes.
- [ ] **Prediction results:** you called it and won · you called it but someone was first · nobody called it (back to the hider) · match postponed or abandoned (back to the hider).
- [ ] **Handle creation / light sign-in:** how a player gets "@nightowl" (needed for leaderboards and anti-farming).
- [ ] **My stashes (hider dashboard):** live / zecked / expired, with a reclaim status.
- [ ] **How it works + rules/terms:** free to play, no purchase necessary, stash cap, custody, claim window (7 days per 08a).
- [ ] **Empty, loading, offline and error states** for the feed and detail screens.
- [ ] **Report a stash** (offensive riddles) and basic moderation.
- [ ] **Desktop layout** for links opened on a laptop from X (a centered phone column is fine for v1).
