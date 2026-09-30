"use client";
// <InstallNudge />: a small, dismissible "Get the ZECKED app" card to place in the feed (or anywhere).
// Hidden when ZECKED already runs as the installed app, and once dismissed (remembered on this device).
// Where the browser has a one-tap install dialog (Chrome, Edge, Samsung Internet) it installs right here;
// everywhere else it opens /install for the steps.
import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { Button } from "@/components/zk/Button";
import { Confetti } from "@/components/zk/Confetti";
import { Icon } from "@/components/zk/Icon";
import { useInstall } from "@/lib/install";

const NUDGE_KEY = "zk:install-nudge";
const NUDGE_EVENT = "zk:install-nudge";

function nudgeDismissed() {
  try {
    return !!localStorage.getItem(NUDGE_KEY);
  } catch {
    return false;
  }
}
function subscribeNudge(onChange: () => void) {
  window.addEventListener(NUDGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(NUDGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
function dismissNudge() {
  try {
    localStorage.setItem(NUDGE_KEY, new Date().toISOString());
  } catch {}
  window.dispatchEvent(new Event(NUDGE_EVENT));
}
// The server (and hydration) always says "dismissed", so the card never flashes in and out.
const hiddenOnServer = () => true;

const card: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-12)",
  padding: "var(--zk-space-12) var(--zk-space-8) var(--zk-space-12) var(--zk-space-12)",
  borderRadius: "var(--zk-radius-2xl)",
  background: "linear-gradient(160deg, #3A2A8C 0%, #221A55 100%)",
  border: "2.5px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .12), 0 3px 0 var(--zk-ink)",
  color: "var(--zk-text)",
};

export function InstallNudge({ style }: { style?: CSSProperties }) {
  const inst = useInstall();
  const dismissed = useSyncExternalStore(subscribeNudge, nudgeDismissed, hiddenOnServer);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);

  if (closed || (!done && (!inst.ready || inst.standalone || dismissed))) return null;
  // Desktop: only when the browser can install it right here (the feed column is phone-first).
  if (!done && inst.platform === "desktop" && !inst.canPrompt) return null;

  const install = async () => {
    setBusy(true);
    const r = await inst.prompt();
    setBusy(false);
    if (r === "accepted") setDone(true);
  };

  if (done || inst.justInstalled) {
    return (
      <section aria-label="ZECKED installed" style={{ ...card, background: "linear-gradient(160deg, #0F6B50 0%, #0B3F33 100%)", ...style }}>
        <Confetti count={28} size="sm" seed={11} />
        <AppIcon />
        <div role="status" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "var(--zk-type-h4)" }}>ZECKED is installed!</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-mint-light)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>
            {inst.platform === "desktop" ? "It opens in its own window now." : "Find it on your Home Screen. One tap and you’re in."}
          </div>
        </div>
        <CloseButton
          onClick={() => {
            setClosed(true);
            dismissNudge();
          }}
          label="Close"
        />
      </section>
    );
  }

  const phone = inst.platform !== "desktop";
  const note = inst.inApp
    ? `Open ZECKED in ${inst.platform === "ios" ? "Safari" : "Chrome"} to add it to your Home Screen.`
    : phone
      ? "ZECKED, one tap from your Home Screen."
      : "ZECKED in its own window, one click away.";

  return (
    <section aria-label="Get the ZECKED app" style={{ ...card, ...style }}>
      <AppIcon />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "var(--zk-type-h4)" }}>Get the app</div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", marginTop: "var(--zk-space-2)", textWrap: "pretty" }}>{note}</div>
      </div>
      {inst.canPrompt ? (
        <Button label={busy ? "…" : "Install"} size="sm" full={false} disabled={busy} onClick={() => void install()} style={{ height: 44, flex: "none", padding: "0 14px" }} />
      ) : (
        <Button label="Show me" size="sm" full={false} href="/install" style={{ height: 44, flex: "none", padding: "0 14px" }} />
      )}
      <CloseButton onClick={dismissNudge} label="Not now" />
    </section>
  );
}

function AppIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icons/icon-192.png" alt="" width={46} height={46} style={{ flex: "none", display: "block", filter: "drop-shadow(0 3px 0 var(--zk-ink))" }} />
  );
}

function CloseButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      data-sfx="tap"
      style={{ width: 32, height: 44, flex: "none", margin: "0 0 0 -4px", padding: 0, border: 0, background: "transparent", color: "var(--zk-text-muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
    >
      <Icon icon="close" size={16} stroke={2.6} />
    </button>
  );
}
