"use client";
// The website's "Get the app" dialog for computers (lazy-loaded by GetApp.tsx): a QR code that opens the
// app's install page on the phone, "Install on this computer" where the browser can, and "just play".
import { useLenis } from "lenis/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/zk";
import { QrCode } from "@/components/zk/QrCode";

const CSS = `
.zkga { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 16px; background: rgb(7 6 15 / .74); animation: zkga-fade .2s ease-out both; }
.zkga-box { position: relative; width: min(700px, 100%); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box; padding: clamp(24px, 4vw, 40px);
  border-radius: 32px; background: radial-gradient(70% 60% at 22% 30%, rgb(var(--zk-gold-rgb) / .16), transparent 70%), linear-gradient(160deg, #2C2257 0%, #17112F 100%);
  border: 2.5px solid var(--zk-ink); box-shadow: inset 0 1.5px 0 rgb(255 255 255 / .1), 0 6px 0 var(--zk-ink), 0 40px 100px rgb(0 0 0 / .6);
  animation: zkga-pop .34s var(--zk-ease-spring) both; }
.zkga-grid { display: grid; grid-template-columns: auto 1fr; gap: clamp(22px, 4vw, 40px); align-items: center; }
@media (max-width: 620px) { .zkga-grid { grid-template-columns: 1fr; justify-items: center; text-align: center; } .zkga-steps li { justify-content: center; } .zkga-actions { align-items: center; } }
.zkga-qr { position: relative; transform: rotate(-2deg); }
.zkga-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px; color: var(--zk-gold); background: rgb(var(--zk-gold-rgb) / .12); border: 1px solid rgb(var(--zk-gold-rgb) / .4); font: var(--zk-type-label); letter-spacing: .14em; text-transform: uppercase; }
.zkga-title { margin: 14px 0 0; font: 800 clamp(28px, 3.4vw, 36px)/1 var(--zk-font-display); letter-spacing: -.025em; text-shadow: 0 3px 0 rgb(var(--zk-purple-rgb) / .6); text-wrap: balance; }
.zkga-steps { margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }
.zkga-steps li { display: flex; align-items: center; gap: 10px; font: var(--zk-type-body); color: var(--zk-text); }
.zkga-num { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--zk-grad-tile-gold); color: var(--zk-gold-ink); border: 2px solid var(--zk-ink); box-shadow: 0 2px 0 var(--zk-ink); font: 800 13px/1 var(--zk-font-display); }
.zkga-actions { margin-top: 22px; display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.zkga-actions .zks-btn { height: 52px; padding: 0 22px; border-radius: 18px; font: var(--zk-type-btn-sm); }
.zkga-play { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; font: var(--zk-type-body-strong); color: var(--zk-text-muted); }
.zkga-play:hover { color: var(--zk-text); }
.zkga-x { position: absolute; top: 14px; right: 14px; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; cursor: pointer; color: var(--zk-text);
  background: var(--zk-surface-raised); border: 2px solid var(--zk-ink); box-shadow: 0 3px 0 var(--zk-ink); transition: transform .12s var(--zk-ease-out); }
.zkga-x:hover { transform: rotate(90deg); }
.zkga-x:active { transform: translateY(2px); box-shadow: 0 1px 0 var(--zk-ink); }
@keyframes zkga-fade { from { opacity: 0 } }
@keyframes zkga-pop { from { opacity: 0; transform: translateY(14px) scale(.94) } }
`;

export default function GetAppModal({ appUrl, onClose }: { appUrl: string; onClose: () => void }) {
  const lenis = useLenis();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Chrome and Edge can install ZECKED on this computer too (from the app's install page).
  const [canInstallHere, setCanInstallHere] = useState(false);
  useEffect(() => setCanInstallHere("onbeforeinstallprompt" in window), []);

  // Hold the page still, focus the dialog, Esc closes, Tab stays inside; focus goes back to the button after.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    if (lenis) lenis.stop();
    else html.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
      if (e.key !== "Tab" || !box.current) return;
      const els = Array.from(box.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (lenis) lenis.start();
      else html.style.overflow = overflow;
      before?.focus?.({ preventScroll: true });
    };
  }, [lenis]);

  const installUrl = `${appUrl}/install`;
  return createPortal(
    <div
      className="zkga"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{CSS}</style>
      <div ref={box} className="zkga-box" role="dialog" aria-modal="true" aria-labelledby="zkga-title" data-lenis-prevent>
        <button type="button" className="zkga-x" aria-label="Close" data-autofocus onClick={onClose}>
          <Icon icon="close" size={20} stroke={2.6} />
        </button>
        <div className="zkga-grid">
          <div className="zkga-qr">
            <QrCode value={installUrl} size={224} label="QR code: opens the ZECKED install page on your phone" />
          </div>
          <div>
            <span className="zkga-eyebrow">
              <Icon icon="sparkle" size={14} stroke={2.4} /> Get the app
            </span>
            <h2 id="zkga-title" className="zkga-title">
              Scan to put ZECKED on your phone
            </h2>
            <ol className="zkga-steps">
              <li>
                <span className="zkga-num">1</span> Open your phone’s camera
              </li>
              <li>
                <span className="zkga-num">2</span> Point it at the code, tap the link
              </li>
              <li>
                <span className="zkga-num">3</span> Tap Install. On iPhone: Share → Add to Home Screen
              </li>
            </ol>
            <div className="zkga-actions">
              {canInstallHere && (
                <a href={installUrl} className="zks-btn zks-btn-purple">
                  <Icon icon="plus" size={18} stroke={2.6} /> Install on this computer
                </a>
              )}
              <a href={appUrl} className="zkga-play">
                or play in your browser <Icon icon="arrowRight" size={16} stroke={2.6} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
