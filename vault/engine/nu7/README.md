# NU7 testnet backport for the vault engine

**What:** makes `bin/zingo-cli` (zingolib tag `zingolib_v6.0.0`) sign and parse
Zcash **testnet** transactions correctly after NU7 activates at testnet block
**4465026** (consensus branch id **`0x77190AD9`**, ZIP 259). Mainnet is unchanged
(no NU7 height).

**Why:** zingolib_v6.0.0 pins `zcash_protocol 0.10.4`, where NU7 only exists behind
`--cfg zcash_unstable="nu7"`, with *no* activation height on any network and the
placeholder branch id `0xFFFFFFFF`. An unpatched engine keeps returning
`BranchId::Nu6_3` (`0x37a5165b`) from `BranchId::for_height` after activation, so:

- every send (`quicksend`: payouts, refunds, withdrawals) is signed for the wrong
  epoch and rejected by the network, and
- `Transaction::read` (zcash_primitives `read_v5_header`) fails on every
  post-activation v5/v6 transaction with "Unknown consensus branch ID", so the
  wallet cannot scan incoming deposits either.

zingolib has not shipped an NU7-aware release; upstream librustzcash fixed this in
`zcash_protocol 0.11.0-pre.0` (2026-09-30), which zingolib_v6.0.0 cannot take (semver
break across the whole `zcash_*` stack).

## Files

| File | Role |
| --- | --- |
| `zcash_protocol/` | `zcash_protocol 0.10.4` from crates.io with 3 value changes (see `zcash_protocol-0.10.4-nu7.patch`): testnet `Nu7 => Some(BlockHeight(4_465_026))`, `0x7719_0ad9 <-> BranchId::Nu7` (both directions). Mainnet `Nu7 => None` is untouched. `src/lib.rs` has a `compile_error!` if the `nu7` cfg is missing. Unit tests pin the values. |
| `zcash_protocol-0.10.4-nu7.patch` | Review diff: pristine crates.io 0.10.4 vs the vendored copy. |
| `zingolib-nu7.patch` | Applied to the zingolib checkout by `scripts/build-engine.sh`: adds `--cfg zcash_unstable="nu7"` to `.cargo/config.toml` (keeps `nu6.3`), adds `[patch.crates-io] zcash_protocol = { path = "vendor/zcash_protocol" }` (+ `exclude`), and adds the `NetworkUpgrade::Nu7` arm to the exhaustive regtest match in `zingolib/src/config.rs`. |

`scripts/build-engine.sh` copies `zcash_protocol/` to `<zingolib>/vendor/zcash_protocol`
and applies `zingolib-nu7.patch` (idempotent), after the received-by-address patch.

## Why the `nu7` cfg instead of un-gating like upstream

With the cfg on, `zcash_primitives 0.30.0` already contains the right NU7 arms:
`TxVersion::suggested_for_branch(Nu7) == V6` (same as NU6.3: "NU7 retains the
existing v6 transaction format"), `valid_in_branch`: V4 rejected (ZIP 2003), V5/V6
accepted, and the builder's Ironwood availability arm `BranchId::Nu7 => true`.
Un-gating by hand would mean vendoring and patching zcash_primitives too. Non-test
code toggled by the cfg in the whole `zingo-cli` clearnet graph is exactly: those
three arms in zcash_primitives, the NU7 items in zcash_protocol, and the one match
arm added to `zingolib/src/config.rs`. ZIP 233 code needs `feature = "zip-233"` as
well and stays off. orchard, sapling-crypto, zcash_keys, zcash_address,
zcash_transparent, zcash_proofs, zcash_pool_migration, zingo_common_components
have no non-test `nu7` gates.

## Verify

```bash
# unit tests of the backport (fast, compiles only zcash_protocol):
cd <zingolib checkout> && cargo test -p zcash_protocol --lib -- nu7 nu_ordering
# or ENGINE_SELFTEST=1 scripts/build-engine.sh
```

## Remove

Delete this directory, the `NU7` block in `scripts/build-engine.sh`, and bump
`ZINGOLIB_TAG` once zingolib ships a release on `zcash_protocol >= 0.11` (its dev
branch is still on 0.10.6 as of 2026-10-03).
