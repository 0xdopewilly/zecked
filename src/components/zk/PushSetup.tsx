"use client";
// Push notification UI: <SwRegister /> (mounted once in the app layout) and <PushPrompt />, a friendly
// "get pinged when someone cracks it" card with the right words for each device state.
import { useEffect, useState } from "react";
import { Button } from "@/components/zk/Button";
import { Icon } from "@/components/zk/Icon";
import { disablePush, enablePush, pushState, registerServiceWorker, type PushState } from "@/lib/push";
import { sfx } from "@/lib/sfx";

export function SwRegister() {
  useEffect(() => {
    const go = () => void registerServiceWorker();
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, []);
  return null;
}

export const PUSH_COPY: Record<PushState, string> = {
  on: "We’ll ping you the second someone cracks your stash.",
  off: "Get a ping the second someone cracks your stash.",
  "install-first": "On iPhone: tap Share → Add to Home Screen, open ZECKED from your Home Screen, then turn this on.",
  denied: "Notifications are blocked for ZECKED in your browser settings.",
  unsupported: "This browser can’t show notifications.",
};

/** Current push state for this device, plus toggles. */
export function usePush() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      setState(s);
      if (s === "on") sfx("success");
    } catch {
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      setState(await disablePush());
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, turnOn, turnOff };
}

/** Card shown right after a stash goes live. Hidden when pings are already on or impossible here. */
export function PushPrompt() {
  const { state, busy, turnOn } = usePush();
  if (state !== "off" && state !== "install-first") return null;
  return (
    <section
      aria-label="Notifications"
      style={{
        display: "flex",
        gap: "var(--zk-space-12)",
        alignItems: "flex-start",
        padding: "var(--zk-space-14)",
        borderRadius: "var(--zk-radius-xl)",
        background: "var(--zk-surface)",
        border: "1px solid var(--zk-border)",
      }}
    >
      <div style={{ width: 40, height: 40, flex: "none", borderRadius: "var(--zk-radius-md)", background: "var(--zk-sky-tint)", color: "var(--zk-sky)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon icon="bell" size={20} stroke={2.4} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
        <div style={{ font: "var(--zk-type-h4)" }}>Get pinged when someone cracks it</div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{PUSH_COPY[state]}</div>
        {state === "off" && <Button label={busy ? "Turning on…" : "Turn on notifications"} icon="bell" variant="sky" size="sm" full={false} disabled={busy} onClick={() => void turnOn()} />}
      </div>
    </section>
  );
}
