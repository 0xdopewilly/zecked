"use client";
// An operator notice at the top of Home and Wallet (env ZECKED_BANNER), for the hours when the money
// side is catching up: "The Zcash vault is catching up after the NU7 upgrade. Your ZEC is safe." Plain
// text, one line or two, no actions: it only has to be honest.
import { Icon } from "./Icon";

export function SystemBanner({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--zk-space-10)",
        padding: "var(--zk-space-10) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-lg)",
        background: "var(--zk-gold-tint, rgb(var(--zk-gold-rgb) / .14))",
        border: "1px solid rgb(var(--zk-gold-rgb) / .35)",
        font: "var(--zk-type-small)",
        color: "var(--zk-text)",
      }}
    >
      <span style={{ color: "var(--zk-gold)", display: "flex", marginTop: 1 }}>
        <Icon icon="info" size={18} stroke={2.4} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{text}</span>
    </div>
  );
}
