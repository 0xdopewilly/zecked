"use client";
// Screen · Get the app (/install). The website's "Get the app" buttons land here, on the app's own site
// (a home-screen app can only be installed from its own origin). One flow per device:
//  - Chrome, Edge, Samsung Internet: "Install ZECKED" opens the browser's own install dialog in one tap.
//  - iPhone / iPad: Share → Add to Home Screen → Add, drawn step by step, with an arrow at the Share button.
//  - Instagram, Facebook, TikTok… built-in browsers can't install: open Safari / Chrome first.
//  - Desktop: install on this computer where the browser can, plus a QR code to get it on the phone.
//  - Already installed: straight to the feed.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Confetti, Icon, Logo } from "@/components/zk";
import { QrCode } from "@/components/zk/QrCode";
import { chromeIntent, copyText, useInstall, type InstallInfo } from "@/lib/install";
import { useAppBack } from "@/lib/nav";
import { sfx } from "@/lib/sfx";

/** How long Chrome gets to offer its install dialog before we show the menu steps instead. */
const PROMPT_WAIT_MS = 1800;

type Spot = "bottom" | "bottom-right" | "top-right";
type Phase = "idle" | "asking" | "done" | "dismissed";

const SCOPED_CSS = `
@keyframes zki-down { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(8px) } }
@keyframes zki-up { 0%, 100% { transform: translateY(0) rotate(180deg) } 50% { transform: translateY(-7px) rotate(180deg) } }
@keyframes zki-in { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes zki-ping { 0% { box-shadow: 0 0 0 0 rgb(var(--zk-gold-rgb) / .75) } 80%, 100% { box-shadow: 0 0 0 8px rgb(var(--zk-gold-rgb) / 0) } }
@keyframes zki-sheen { from { background-position: 200% 0 } to { background-position: -200% 0 } }
.zki-in { animation: zki-in 420ms var(--zk-ease-out) both; }
/* Small or short phones: a smaller hero, so step 1 shows without scrolling. */
@media (max-width: 360px) { .zki-title { font-size: var(--zk-fs-30) !important; } }
@media (max-height: 620px) { .zki-perks { display: none !important; } }
@media (max-height: 700px) { .zki-hero { height: 92px !important; } .zki-icon { width: 76px !important; height: 76px !important; } }
.zki-point { animation: zki-in 420ms var(--zk-ease-out) 700ms both; }
.zki-skel { background: linear-gradient(90deg, var(--zk-surface) 0%, var(--zk-surface-raised) 50%, var(--zk-surface) 100%); background-size: 200% 100%; animation: zki-sheen 1.6s linear infinite; }
`;

/* ---------- little drawings of the browser's own buttons ---------- */

const GLYPH: Record<string, string[]> = {
  share: ["M12 3v12", "M8 7l4-4 4 4", "M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2"],
  addSquare: ["M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z", "M12 8v8", "M8 12h8"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  back: ["M15 5l-7 7 7 7"],
  fwd: ["M9 5l7 7-7 7"],
  book: ["M3.5 5.5h5a3 3 0 0 1 3 3v11a2.5 2.5 0 0 0-2.5-2.5h-5.5z", "M20.5 5.5h-5a3 3 0 0 0-3 3v11a2.5 2.5 0 0 1 2.5-2.5h5.5z"],
  tabs: ["M8 8h11v11H8z", "M5 16V5h11"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  compass: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M15.5 8.5l-2 5-5 2 2-5z"],
  phoneDown: ["M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z", "M12 7.5v7", "M9.5 12l2.5 2.5 2.5-2.5"],
  desktopDown: ["M3 4.5h18v11.5H3z", "M8.5 20h7", "M12 16v4", "M12 7v5.5", "M9.5 10l2.5 2.5 2.5-2.5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  aA: ["M3 18l4-10 4 10", "M4.5 14.5h5", "M14 18v-4.5a2.5 2.5 0 0 1 5 0V18", "M14 15.5h5"],
};
const DOTS: Record<string, [number, number][]> = {
  dots: [[5, 12], [12, 12], [19, 12]],
  kebab: [[12, 5], [12, 12], [12, 19]],
};

function Glyph({ name, size = 20, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      {DOTS[name] ? DOTS[name].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={2} fill="currentColor" stroke="none" />) : <path d={(GLYPH[name] || []).join(" ")} />}
    </svg>
  );
}

// Mock-ups of the phone's own UI: light and system-font, so they read as "your browser", not ZECKED.
const IOS_BLUE = "#0A7CFF";
const mockBar: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 16,
  maxWidth: "100%",
  padding: "9px 14px",
  borderRadius: 16,
  background: "#F2F2F7",
  color: "#8A8A93",
  font: "600 13px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  boxShadow: "0 3px 0 rgb(var(--zk-black-rgb) / .35)",
};
const mockUrl: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  padding: "5px 10px",
  borderRadius: 10,
  background: "#E3E3E8",
  color: "#3C3C43",
  fontWeight: 500,
};

/** The spot to tap inside a mock: its real colour plus a gold "tap here" ring that pulses. */
function Hot({ children, color = IOS_BLUE }: { children: ReactNode; color?: string }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, color }}>
      <span aria-hidden="true" style={{ position: "absolute", inset: -7, borderRadius: 999, border: "2.5px solid var(--zk-gold)", animation: "zki-ping 1.6s var(--zk-ease-out) infinite" }} />
      {children}
    </span>
  );
}

/** A menu / share-sheet list with one row picked out. */
function MockList({ rows, pick, icon }: { rows: string[]; pick: number; icon: string }) {
  return (
    <div style={{ ...mockBar, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 0, padding: "4px 18px", width: "100%", maxWidth: 260, boxSizing: "border-box" }}>
      {rows.map((r, i) => (
        <div
          key={r}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 0",
            borderTop: i ? "1px solid #DCDCE2" : 0,
            color: i === pick ? "#111114" : "#AEAEB5",
            fontWeight: i === pick ? 700 : 500,
          }}
        >
          {i === pick ? (
            <Hot color="#111114">
              <span style={{ padding: "0 2px" }}>{r}</span>
            </Hot>
          ) : (
            <span>{r}</span>
          )}
          <span style={{ color: i === pick ? "#111114" : "#C4C4CA" }}>
            <Glyph name={i === pick ? icon : "copy"} size={17} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- building blocks ---------- */

const card: CSSProperties = {
  position: "relative",
  borderRadius: "var(--zk-radius-2xl)",
  background: "linear-gradient(180deg, #2C2257 0%, #1C1542 100%)",
  border: "2.5px solid var(--zk-ink)",
  boxShadow: "inset 0 1.5px 0 rgb(var(--zk-white-rgb) / .1), 0 3px 0 var(--zk-ink)",
};

function Step({ n, title, hint, children, last }: { n: number; title: ReactNode; hint?: ReactNode; children?: ReactNode; last?: boolean }) {
  return (
    <li className="zki-in" style={{ display: "flex", gap: "var(--zk-space-12)", padding: "var(--zk-space-14) var(--zk-space-14)", borderBottom: last ? 0 : "1px solid var(--zk-border)", animationDelay: `${n * 90}ms` }}>
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--zk-grad-tile-gold)",
          color: "var(--zk-gold-ink)",
          border: "2.5px solid var(--zk-ink)",
          boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-ink)",
          font: "var(--zk-fw-black) 16px/1 var(--zk-font-display)",
        }}
      >
        {n}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-4)" }}>
        <div style={{ font: "var(--zk-type-h4)", fontSize: "var(--zk-fs-18)", textWrap: "pretty" }}>{title}</div>
        {hint && <div style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{hint}</div>}
        {children && <div style={{ marginTop: "var(--zk-space-10)", display: "flex" }}>{children}</div>}
      </div>
    </li>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol style={{ ...card, margin: 0, padding: 0, listStyle: "none" }}>{children}</ol>;
}

/** A big bouncing arrow pinned to the edge of the screen, pointing at the browser's own button. */
function PointArrow({ spot, label }: { spot: Spot; label: string }) {
  const up = spot === "top-right";
  const pos: CSSProperties =
    spot === "top-right"
      ? { top: "calc(env(safe-area-inset-top, 0px) + 12px)", right: 14 }
      : spot === "bottom-right"
        ? { bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)", right: 16 }
        : { bottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)", left: "50%", marginLeft: -17 };
  return (
    <>
      {/* Content fades out under a bottom arrow, so the two never fight. */}
      {!up && (
        <div
          aria-hidden="true"
          style={{ position: "fixed", left: 0, right: 0, bottom: 0, height: "calc(env(safe-area-inset-bottom, 0px) + 96px)", zIndex: 94, pointerEvents: "none", background: "linear-gradient(to bottom, transparent, rgb(var(--zk-bg-rgb) / .94) 70%)" }}
        />
      )}
      <div aria-hidden="true" className="zki-point" style={{ position: "fixed", zIndex: 95, width: 34, height: 48, pointerEvents: "none", ...pos }}>
        <svg viewBox="0 0 40 56" width={34} height={48} style={{ display: "block", overflow: "visible", animation: `${up ? "zki-up" : "zki-down"} 1.1s var(--zk-ease-in-out) infinite` }}>
          <defs>
            <linearGradient id="zki-arrow" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--zk-gold-pale)" />
              <stop offset="1" stopColor="var(--zk-gold)" />
            </linearGradient>
          </defs>
          <polygon points="14,2 26,2 26,31 37,31 20,53 3,31 14,31" fill="url(#zki-arrow)" stroke="var(--zk-ink)" strokeWidth={3} strokeLinejoin="round" />
        </svg>
        <span
          style={{
            position: "absolute",
            // Up top the label hangs under the arrow (clear of the header); at the bottom it sits beside it.
            ...(up ? { top: "calc(100% + 6px)", right: -4 } : { bottom: 6, right: "calc(100% + 8px)" }),
            padding: "7px 12px",
            borderRadius: "var(--zk-radius-pill)",
            background: "var(--zk-gold)",
            color: "var(--zk-gold-ink)",
            border: "2.5px solid var(--zk-ink)",
            boxShadow: "0 3px 0 var(--zk-ink)",
            font: "var(--zk-type-btn-sm)",
            whiteSpace: "nowrap",
            transform: "rotate(-3deg)",
          }}
        >
          {label}
        </span>
      </div>
    </>
  );
}

const PERKS: [string, string][] = [
  ["bolt", "Full screen"],
  ["bell", "Win alerts"],
  ["sparkle", "No app store"],
];

function Perks() {
  return (
    <ul className="zki-in zki-perks" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "var(--zk-space-6)", animationDelay: "60ms" }}>
      {PERKS.map(([icon, label]) => (
        <li
          key={label}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", borderRadius: "var(--zk-radius-pill)", background: "rgb(var(--zk-white-rgb) / .06)", border: "1px solid var(--zk-border-strong)", font: "var(--zk-type-caption)", color: "var(--zk-text)", whiteSpace: "nowrap" }}
        >
          <span style={{ color: "var(--zk-gold)", display: "flex" }}>
            <Icon icon={icon} size={14} stroke={2.4} />
          </span>
          {label}
        </li>
      ))}
    </ul>
  );
}

function Note({ children, icon = "info" }: { children: ReactNode; icon?: string }) {
  return (
    <p style={{ margin: 0, display: "flex", gap: "var(--zk-space-8)", alignItems: "flex-start", font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>
      <span style={{ color: "var(--zk-gold)", display: "flex", paddingTop: 1 }}>
        {icon === "compass" ? <Glyph name="compass" size={16} stroke={2.2} /> : <Icon icon={icon} size={16} stroke={2.4} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{children}</span>
    </p>
  );
}

function useInstallUrl() {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/install`), []);
  return url;
}

/** Copy the install link, with a "Copied!" moment. */
function CopyLink({ variant = "ghost", label = "Copy link" }: { variant?: "primary" | "ghost"; label?: string }) {
  const url = useInstallUrl();
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
      <Button
        label={copied ? "Copied!" : label}
        icon={copied ? "check" : "copy"}
        variant={copied ? "success" : variant}
        size="md"
        sfx="none"
        onClick={async () => {
          const ok = await copyText(url);
          setCopied(ok);
          if (ok) sfx("success");
        }}
      />
      {copied === false && (
        <p style={{ margin: 0, font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textAlign: "center", userSelect: "all", WebkitUserSelect: "all" }}>{url}</p>
      )}
    </div>
  );
}

/* ---------- flows ---------- */

function IosSteps({ inst }: { inst: InstallInfo }) {
  const safari = inst.browser === "safari";
  const tucked = safari && inst.safariVersion >= 26 && !inst.ipad; // iOS 26 Safari: Share lives under •••
  const topBar = inst.ipad || inst.browser === "chrome";
  const spot: Spot = topBar ? "top-right" : tucked ? "bottom-right" : "bottom";
  return (
    <>
      <Steps>
        <Step
          n={1}
          title={tucked ? "Tap ••• then Share" : "Tap the Share button"}
          hint={
            tucked
              ? "••• is at the bottom right, next to the address bar. See the Share icon itself? Tap that."
              : topBar
                ? inst.ipad && safari
                  ? "Top right of the screen, next to the address bar."
                  : "At the right end of the address bar, at the top."
                : "In the bar at the bottom of the screen."
          }
        >
          {tucked ? (
            <div style={{ ...mockBar, gap: 12, width: "100%", maxWidth: 260, boxSizing: "border-box" }}>
              <Glyph name="back" size={18} />
              <span style={mockUrl}>zecked</span>
              <Hot>
                <Glyph name="dots" size={20} />
              </Hot>
            </div>
          ) : topBar ? (
            <div style={{ ...mockBar, gap: 12, width: "100%", maxWidth: 260, boxSizing: "border-box" }}>
              {inst.ipad && safari && <Glyph name="aA" size={18} />}
              <span style={mockUrl}>zecked</span>
              <Hot>
                <Glyph name="share" size={20} />
              </Hot>
              {inst.ipad && safari && <Glyph name="tabs" size={18} />}
            </div>
          ) : (
            <div style={mockBar}>
              <Glyph name="back" size={20} />
              <Glyph name="fwd" size={20} />
              <Hot>
                <Glyph name="share" size={22} />
              </Hot>
              <Glyph name="book" size={20} />
              <Glyph name="tabs" size={20} />
            </div>
          )}
        </Step>
        <Step n={2} title={<>Tap “Add to Home Screen”</>} hint="Scroll down the list a little if you don’t see it.">
          <MockList rows={["Copy", "Add to Home Screen", "Add Bookmark"]} pick={1} icon="addSquare" />
        </Step>
        <Step n={3} title={<>Tap “Add”</>} hint={tucked ? "Top right. Leave “Open as Web App” on. That’s it!" : "Top right. That’s it: ZECKED is on your Home Screen."} last>
          <div style={{ ...mockBar, gap: 12, width: "100%", maxWidth: 260, boxSizing: "border-box", justifyContent: "space-between" }}>
            <span style={{ color: IOS_BLUE, fontWeight: 500 }}>Cancel</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#111114" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/icon-192.png" alt="" width={22} height={22} style={{ display: "block", borderRadius: 5 }} />
              ZECKED
            </span>
            <Hot>
              <span style={{ fontWeight: 700, padding: "0 4px" }}>Add</span>
            </Hot>
          </div>
        </Step>
      </Steps>
      {safari && (
        <Note icon="compass">
          No “Add to Home Screen”? You might be in another app’s browser (X, Telegram…). Tap the compass or “Open in Safari” first, then do the steps.
        </Note>
      )}
      <PointArrow spot={spot} label={tucked ? "Tap ••• here" : topBar ? "Share is up here" : "Tap Share"} />
    </>
  );
}

function AndroidSteps({ inst, again }: { inst: InstallInfo; again: boolean }) {
  const samsung = inst.browser === "samsung";
  const chrome = inst.browser === "chrome";
  return (
    <>
      {again && <Note icon="info">No worries. Changed your mind later? It’s 3 taps from the browser menu:</Note>}
      <Steps>
        <Step
          n={1}
          title={samsung ? "Tap ≡ at the bottom right" : chrome ? "Tap ⋮ at the top right" : "Open your browser’s menu"}
          hint={samsung ? "The menu button in the bar at the bottom." : chrome ? "The three dots, next to the address bar." : "Usually ⋮ or ••• next to the address bar."}
        >
          {samsung ? (
            <div style={mockBar}>
              <Glyph name="back" size={20} />
              <Glyph name="fwd" size={20} />
              <Glyph name="book" size={20} />
              <Glyph name="tabs" size={20} />
              <Hot color="#111114">
                <Glyph name="menu" size={22} />
              </Hot>
            </div>
          ) : (
            <div style={{ ...mockBar, gap: 12, width: "100%", maxWidth: 260, boxSizing: "border-box" }}>
              <span style={mockUrl}>zecked-testnet.vercel.app</span>
              <Hot color="#111114">
                <Glyph name="kebab" size={20} />
              </Hot>
            </div>
          )}
        </Step>
        <Step
          n={2}
          title={samsung ? <>Tap “Add page to”, then “Home screen”</> : <>Tap “Add to Home screen”</>}
          hint={samsung ? undefined : "It might say “Install app” instead. Same thing."}
        >
          <MockList rows={samsung ? ["Share", "Add page to", "Find on page"] : ["New tab", "Add to Home screen", "Share…"]} pick={1} icon="phoneDown" />
        </Step>
        <Step n={3} title={samsung ? <>Tap “Add”</> : <>Tap “Install”</>} hint="That’s it: ZECKED is on your Home Screen." last />
      </Steps>
      {inst.wasInstalled && <Note icon="check">Already installed ZECKED? Open it from your Home Screen.</Note>}
      {samsung ? <PointArrow spot="bottom-right" label="Menu is down here" /> : chrome ? <PointArrow spot="top-right" label="Menu is up here" /> : null}
    </>
  );
}

function InAppSteps({ inst }: { inst: InstallInfo }) {
  const ios = inst.platform === "ios";
  const browser = ios ? "Safari" : "Chrome";
  const url = useInstallUrl();
  return (
    <>
      <div className="zki-in" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
        {!ios && url && (
          <Button label="Open in Chrome" icon="share" size="lg" onClick={() => void (window.location.href = chromeIntent(url))} />
        )}
        <CopyLink variant={ios ? "primary" : "ghost"} label={ios ? "Copy the link" : "Copy link"} />
        {ios && <p style={{ margin: 0, font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textAlign: "center" }}>Then open Safari and paste it in the address bar.</p>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-10)", color: "var(--zk-text-faint)", font: "var(--zk-type-label)", letterSpacing: "var(--zk-track-label)" }}>
        <span style={{ flex: 1, height: 1, background: "var(--zk-border)" }} />
        OR
        <span style={{ flex: 1, height: 1, background: "var(--zk-border)" }} />
      </div>
      <Steps>
        <Step n={1} title={`Tap ${ios ? "•••" : "⋮"} at the top right`} hint={`The menu of ${inst.inApp === "this app" ? "this app’s" : `${inst.inApp}’s`} browser.`}>
          <div style={{ ...mockBar, gap: 12, width: "100%", maxWidth: 260, boxSizing: "border-box" }}>
            <Glyph name="close" size={18} />
            <span style={mockUrl}>zecked-testnet.vercel.app</span>
            <Hot color="#111114">
              <Glyph name={ios ? "dots" : "kebab"} size={20} />
            </Hot>
          </div>
        </Step>
        <Step n={2} title={<>Tap “Open in {browser}”</>} hint="It might say “Open in browser” or “Open in external browser”." />
        <Step n={3} title="Add ZECKED from there" hint={`${browser} shows you how. It takes 10 seconds.`} last />
      </Steps>
      <PointArrow spot="top-right" label="Menu is up here" />
    </>
  );
}

function IosOtherBrowser({ inst }: { inst: InstallInfo }) {
  const name = inst.browser === "firefox" ? "Firefox" : inst.browser === "edge" ? "Edge" : inst.browser === "opera" ? "Opera" : inst.browser === "chrome" ? "Chrome" : "this browser";
  const newEnough = inst.iosVersion >= 16.4;
  return (
    <>
      <Steps>
        <Step n={1} title="Copy this page’s link">
          <div style={{ width: "100%" }}>
            <CopyLink variant="primary" />
          </div>
        </Step>
        <Step n={2} title="Open Safari and paste it" hint="Tap the address bar, paste, go." />
        <Step n={3} title="Follow the 3 quick steps there" hint="Share → Add to Home Screen → Add." last />
      </Steps>
      {newEnough && <Note icon="info">Or stay in {name}: open its menu, tap Share, then “Add to Home Screen”.</Note>}
    </>
  );
}

function DesktopFlow({ inst, onInstall, busy }: { inst: InstallInfo; onInstall: () => void; busy: boolean }) {
  const url = useInstallUrl();
  const macSafari = inst.browser === "safari";
  return (
    <>
      {inst.canPrompt && (
        <div className="zki-in" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-8)" }}>
          <Button label={busy ? "Installing…" : "Install on this computer"} icon="plus" size="lg" disabled={busy} onClick={onInstall} />
          <p style={{ margin: 0, font: "var(--zk-type-small)", color: "var(--zk-text-muted)", textAlign: "center" }}>ZECKED gets its own window, one click away.</p>
        </div>
      )}
      <section aria-label="Get it on your phone" className="zki-in" style={{ ...card, padding: "var(--zk-space-18)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-14)", animationDelay: "120ms" }}>
        <div style={{ font: "var(--zk-type-h3)", textAlign: "center" }}>{inst.canPrompt ? "Or get it on your phone" : "Scan with your phone"}</div>
        {url ? <QrCode value={url} size={196} label="QR code: opens the ZECKED install page on your phone" /> : <div style={{ width: 196, height: 196 }} />}
        <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "var(--zk-space-8)", alignSelf: "stretch" }}>
          {["Open your phone’s camera", "Point it at the code, tap the link", "Tap Install (or Share → Add to Home Screen)"].map((t, i) => (
            <li key={t} style={{ display: "flex", gap: "var(--zk-space-10)", alignItems: "center", font: "var(--zk-type-small)", color: "var(--zk-text)" }}>
              <span style={{ width: 24, height: 24, flex: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--zk-purple)", border: "2px solid var(--zk-ink)", font: "var(--zk-fw-black) 12px/1 var(--zk-font-display)" }}>{i + 1}</span>
              {t}
            </li>
          ))}
        </ol>
      </section>
      {!inst.canPrompt && inst.promptSupported && (
        <Note icon="info">
          <span style={{ display: "inline-flex", verticalAlign: "-4px", marginRight: 4, color: "var(--zk-text)" }}>
            <Glyph name="desktopDown" size={18} />
          </span>
          Want it on this computer too? Click the install icon at the right end of the address bar.
        </Note>
      )}
      {macSafari && <Note icon="info">On a Mac with Safari? Choose File → Add to Dock to keep ZECKED one click away.</Note>}
      {inst.browser === "firefox" && <Note icon="info">Firefox can’t install web apps. Scan the code to get ZECKED on your phone.</Note>}
    </>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)" }}>
      <div className="zki-skel" style={{ height: 62, borderRadius: "var(--zk-radius-2xl)" }} />
      <div className="zki-skel" style={{ height: 150, borderRadius: "var(--zk-radius-2xl)", opacity: 0.6 }} />
    </div>
  );
}

/* ---------- screen ---------- */

export default function InstallScreen() {
  const back = useAppBack("/feed");
  const inst = useInstall();
  const [phase, setPhase] = useState<Phase>("idle");
  const [patient, setPatient] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPatient(true), PROMPT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  const install = async () => {
    setPhase("asking");
    const r = await inst.prompt();
    setPhase(r === "accepted" ? "done" : "dismissed");
  };

  const success = phase === "done" || (inst.justInstalled && !inst.standalone);
  const ios = inst.platform === "ios";
  const desktop = inst.platform === "desktop";
  const iosOk = inst.browser === "safari" || (inst.browser === "chrome" && inst.iosVersion >= 16.4);
  const flow = !inst.ready
    ? "loading"
    : success
      ? "success"
      : inst.standalone
        ? "installed"
        : inst.inApp
          ? "inapp"
          : ios
            ? iosOk
              ? "ios"
              : "ios-other"
            : desktop
              ? "desktop"
              : inst.canPrompt || phase === "asking"
                ? "prompt"
                : inst.promptSupported && !patient && phase === "idle"
                  ? "loading"
                  : "android";

  const head: Record<typeof flow, { title: ReactNode; sub: ReactNode }> = {
    loading: { title: "Get the ZECKED app", sub: "Full screen, one tap away." },
    success: {
      title: desktop ? "ZECKED is installed!" : "It’s on your Home Screen!",
      sub: desktop ? "It opens in its own window now. Find it with your other apps." : "Look for the ZECKED icon. Tap it any time to jump straight in.",
    },
    installed: { title: "You’ve got it.", sub: desktop ? "ZECKED is installed on this computer, and you’re in it." : "ZECKED is on your Home Screen, and you’re in it right now." },
    inapp: {
      title: `Open ZECKED in ${ios ? "Safari" : "Chrome"} first`,
      sub: `${inst.inApp === "this app" ? "This app’s" : `${inst.inApp}’s`} built-in browser can’t add apps to your Home Screen. ${ios ? "Safari" : "Chrome"} can, in a few taps.`,
    },
    ios: { title: <>Add ZECKED to your Home&nbsp;Screen</>, sub: "3 quick taps. Then it opens full screen, like a real app." },
    "ios-other": { title: "Open this page in Safari", sub: "Safari puts ZECKED on your Home Screen in 3 quick taps." },
    desktop: {
      title: inst.canPrompt ? "Get the ZECKED app" : "Get ZECKED on your phone",
      sub: inst.canPrompt ? "Install it here, or scan the code to put it on your phone." : "Scan the code with your phone’s camera. It opens the install page there.",
    },
    prompt: { title: "Get the ZECKED app", sub: "Full screen, one tap away. Free, and no app store." },
    android: { title: "Get the ZECKED app", sub: "3 quick taps. Then it opens full screen, like a real app." },
  };
  const h = head[flow];
  const arrowAtBottom = (flow === "ios" && !inst.ipad && inst.browser === "safari") || (flow === "android" && inst.browser === "samsung");

  return (
    <main
      className="zk-screen"
      style={{
        background: success ? "var(--zk-bg-win)" : "var(--zk-bg-hero-purple)",
        gap: "var(--zk-space-18)",
        paddingBottom: arrowAtBottom ? "calc(env(safe-area-inset-bottom, 0px) + 110px)" : undefined,
        transition: "background var(--zk-dur-base) var(--zk-ease-out)",
      }}
    >
      <style>{SCOPED_CSS}</style>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          aria-label="Back"
          onClick={back}
          style={{ width: 44, height: 44, borderRadius: "var(--zk-radius-lg)", background: "var(--zk-surface)", border: 0, color: "var(--zk-text)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
        >
          <Icon icon="back" size={22} stroke={2.4} />
        </button>
        <Logo variant="wordmark" size={22} />
        <span style={{ width: 44 }} />
      </nav>

      {/* The icon they'll get, on a slow sunburst */}
      <div className="zki-hero" style={{ position: "relative", height: 132, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 320,
            height: 320,
            margin: "-160px 0 0 -160px",
            borderRadius: "50%",
            background: "var(--zk-sunburst-gold)",
            WebkitMaskImage: "radial-gradient(closest-side, #000 30%, transparent)",
            maskImage: "radial-gradient(closest-side, #000 30%, transparent)",
            animation: "zk-spin 40s linear infinite",
            willChange: "transform",
          }}
        />
        <div style={{ position: "relative", "--zk-tilt": "-4deg", animation: "zk-bob 3.4s ease-in-out infinite" } as CSSProperties}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-512.png"
            alt="The ZECKED app icon"
            className="zki-icon"
            width={112}
            height={112}
            style={{ display: "block", filter: "drop-shadow(0 6px 0 var(--zk-ink)) drop-shadow(0 18px 28px rgb(var(--zk-purple-rgb) / .5))" }}
          />
          {(success || flow === "installed") && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                right: -12,
                bottom: -8,
                width: 48,
                height: 48,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--zk-mint)",
                color: "var(--zk-mint-ink)",
                border: "3px solid var(--zk-ink)",
                boxShadow: "var(--zk-inset-gloss), 0 3px 0 var(--zk-ink)",
                animation: "zk-pop var(--zk-dur-pop) var(--zk-ease-spring) both",
              }}
            >
              <Icon icon="check" size={26} stroke={3.2} />
            </span>
          )}
        </div>
      </div>

      <header style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--zk-space-10)", textAlign: "center" }}>
        <h1 className="zk-title zki-title" style={{ margin: 0, textWrap: "balance" }}>
          {h.title}
        </h1>
        <p style={{ margin: 0, maxWidth: 330, font: "var(--zk-type-body-lg)", color: "var(--zk-text-muted)", textWrap: "pretty" }}>{h.sub}</p>
      </header>

      {(flow === "prompt" || flow === "ios" || flow === "android" || flow === "loading") && <Perks />}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-14)" }}>
        {flow === "loading" && <Skeleton />}

        {flow === "prompt" && (
          <div className="zki-in" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
            <Button label={phase === "asking" ? "Installing…" : "Install ZECKED"} icon="plus" size="lg" disabled={phase === "asking"} onClick={() => void install()} />
            <Button label="Keep playing in the browser" variant="ghost" size="md" href="/feed" />
          </div>
        )}

        {flow === "android" && <AndroidSteps inst={inst} again={phase === "dismissed"} />}
        {flow === "ios" && <IosSteps inst={inst} />}
        {flow === "ios-other" && <IosOtherBrowser inst={inst} />}
        {flow === "inapp" && <InAppSteps inst={inst} />}
        {flow === "desktop" && <DesktopFlow inst={inst} busy={phase === "asking"} onInstall={() => void install()} />}

        {(flow === "installed" || flow === "success") && (
          <div className="zki-in" style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-12)" }}>
            <Button label={flow === "installed" ? "Open ZECKED" : "Keep playing"} iconRight="arrowRight" size="lg" href="/feed" />
            {flow === "success" && ios === false && !desktop && <Note icon="bell">Next: turn on win alerts in your Profile, so you hear the second someone cracks your stash.</Note>}
          </div>
        )}

        {(flow === "desktop" || flow === "android" || flow === "ios") && (
          <Button label="Play in your browser for now" variant="ghost" size="md" iconRight="arrowRight" href="/feed" style={{ marginTop: "var(--zk-space-4)" }} />
        )}
      </div>

      {flow === "success" && (
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, zIndex: 60, pointerEvents: "none" }}>
          <Confetti count={90} seed={23} />
        </div>
      )}
    </main>
  );
}
