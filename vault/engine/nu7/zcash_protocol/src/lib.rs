//! *A crate for Zcash protocol constants and value types.*
//!
//! `zcash_protocol` contains Rust structs, traits and functions that provide the network constants
//! for the Zcash main and test networks, as well types for representing ZEC amounts and value
//! balances.
//!
#![cfg_attr(feature = "std", doc = "## Feature flags")]
#![cfg_attr(feature = "std", doc = document_features::document_features!())]
//!

#![no_std]
#![cfg_attr(docsrs, feature(doc_cfg))]
#![cfg_attr(docsrs, doc(auto_cfg))]
// Catch documentation errors caused by code changes.
#![deny(rustdoc::broken_intra_doc_links)]

// ZECKED vendored copy (ZECKED/vault/engine/nu7/zcash_protocol): zcash_protocol 0.10.4 with
// the NU7 testnet activation height (4465026) and ZIP 259 consensus branch id (0x77190AD9)
// backported from zcash_protocol 0.11.0-pre.0. The backport sits behind the same
// `zcash_unstable = "nu7"` cfg as upstream's NU7 code, so a build that forgot the cfg would
// silently produce a pre-NU7 wallet engine whose sends get rejected after activation.
// Refuse to compile instead.
#[cfg(not(zcash_unstable = "nu7"))]
compile_error!(
    "ZECKED vendored zcash_protocol needs --cfg zcash_unstable=\"nu7\" (zingolib/.cargo/config.toml, applied by vault/scripts/build-engine.sh); see vault/engine/nu7/README.md"
);

#[cfg_attr(any(test, feature = "test-dependencies"), macro_use)]
extern crate alloc;

#[cfg(feature = "std")]
extern crate std;

use core::fmt;

pub mod consensus;
pub mod constants;
#[cfg(feature = "local-consensus")]
pub mod local_consensus;
pub mod memo;
pub mod value;
pub mod zip318;

mod txid;
pub use txid::TxId;

/// A Zcash shielded pool.
#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ShieldedPool {
    /// The Sapling pool
    Sapling,
    /// The Orchard pool
    Orchard,
    /// The Ironwood pool
    Ironwood,
}

#[deprecated(note = "Use `ShieldedPool` instead.")]
pub type ShieldedProtocol = ShieldedPool;

/// A value pool in the Zcash protocol.
#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum PoolType {
    /// The transparent value pool
    Transparent,
    /// A shielded value pool.
    Shielded(ShieldedPool),
}

impl PoolType {
    pub const TRANSPARENT: PoolType = PoolType::Transparent;
    pub const SAPLING: PoolType = PoolType::Shielded(ShieldedPool::Sapling);
    pub const ORCHARD: PoolType = PoolType::Shielded(ShieldedPool::Orchard);
    pub const IRONWOOD: PoolType = PoolType::Shielded(ShieldedPool::Ironwood);
}

impl fmt::Display for PoolType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PoolType::Transparent => f.write_str("Transparent"),
            PoolType::Shielded(ShieldedPool::Sapling) => f.write_str("Sapling"),
            PoolType::Shielded(ShieldedPool::Orchard) => f.write_str("Orchard"),
            PoolType::Shielded(ShieldedPool::Ironwood) => f.write_str("Ironwood"),
        }
    }
}

#[cfg(any(test, feature = "test-dependencies"))]
pub mod testing {
    use proptest::prelude::{Just, Strategy, prop_oneof};

    use super::ShieldedPool;

    pub use crate::txid::testing::arb_txid;

    /// A [`proptest`] strategy that yields a [`ShieldedPool`] variant uniformly at
    /// random.
    ///
    /// This is useful for properties that should hold for every shielded protocol, so that
    /// the protocol does not have to be hard-coded in each test.
    pub fn arb_protocol() -> impl Strategy<Value = ShieldedPool> {
        prop_oneof![Just(ShieldedPool::Sapling), Just(ShieldedPool::Orchard),]
    }
}
