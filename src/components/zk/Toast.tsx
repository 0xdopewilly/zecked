"use client";
import { useEffect, type ReactNode } from "react";
import { Icon, type IconProp } from "@/components/zk/Icon";
import { sfx, type Sound } from "@/lib/sfx";

/* Port of "ZK Toast": default · success · error · gold. */

export type ToastVariant = "default" | "success" | "error" | "gold";

export interface ToastProps {
  text?: ReactNode;
  meta?: ReactNode;
  /** Overrides the variant's default icon. */
  icon?: IconProp;
  variant?: ToastVariant;
  /** Sound when it appears (default: by variant); false for silence. */
  sound?: Sound | false;
}

const SOUND: Record<ToastVariant, Sound> = { default: "notify", success: "notify", error: "error", gold: "coin" };

const T: Record<ToastVariant, [tileBg: string, tileFg: string, icon: IconProp]> = {
  default: ["var(--zk-purple-tint)", "var(--zk-purple-light)", "bell"],
  success: ["var(--zk-mint-tint)", "var(--zk-mint)", "unlock"],
  error: ["var(--zk-red-tint)", "var(--zk-red)", "close"],
  gold: ["var(--zk-gold-tint)", "var(--zk-gold)", "coin"],
};

export function Toast({ text, meta, icon, variant = "success", sound }: ToastProps) {
  useEffect(() => {
    const s = sound === undefined ? SOUND[variant] : sound;
    if (s) sfx(s);
    // Play once per toast (each toast mounts with its own key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const t = T[variant] || T.success;
  const hasMeta = meta !== undefined && meta !== null && meta !== "" && meta !== false;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--zk-space-12)",
        padding: "var(--zk-space-12) var(--zk-space-14)",
        borderRadius: "var(--zk-radius-xl)",
        background: "var(--zk-surface-raised)",
        border: "1px solid var(--zk-border)",
        boxShadow: "var(--zk-shadow-float)",
      }}
    >
      <div
        style={{
          width: "36px",
          height: "36px",
          borderRadius: "var(--zk-radius-md)",
          background: t[0],
          color: t[1],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
        }}
      >
        <Icon icon={icon || t[2]} size={18} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0, font: "var(--zk-type-small)", color: "var(--zk-text)", textWrap: "pretty" }}>
        {text ?? "@nightowl just ZECKED 0.02 ZEC"}
      </div>
      {hasMeta ? <span style={{ font: "var(--zk-type-mono-xs)", color: "var(--zk-text-muted)", flex: "none" }}>{meta}</span> : null}
    </div>
  );
}
