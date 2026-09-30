"use client";
// Installing ZECKED as a home-screen app, on this device.
//  - Chrome, Edge and Samsung Internet (Android and desktop) fire `beforeinstallprompt`: <InstallCapture />
//    parks it on window.__zkInstall and prompt() shows the browser's own install dialog in one tap.
//  - iPhone and iPad have no install prompt: it's Share → Add to Home Screen (Safari, or Chrome on iOS 16.4+).
//  - In-app browsers (Instagram, Facebook, X, TikTok, Telegram…) can't install at all: open Safari/Chrome first.
import { useSyncExternalStore } from "react";
import { INSTALL_EVENT, INSTALLED_KEY } from "@/components/zk/InstallCapture";

export type InstallPlatform = "ios" | "android" | "desktop";
/** The browser the steps talk about. */
export type InstallBrowser = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "opera" | "other";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

interface PromptEvent extends Event {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

declare global {
  interface Window {
    __zkInstall?: { prompt: PromptEvent | null; installed: boolean };
  }
}

export interface InstallInfo {
  /** False on the server and during hydration: render a neutral state until it flips. */
  ready: boolean;
  platform: InstallPlatform;
  browser: InstallBrowser;
  ipad: boolean;
  /** Safari's major version (26+ tucks Share under the ••• button on iPhone). 0 when not Safari. */
  safariVersion: number;
  /** iOS version as a number (16.4 → 16.4). 0 when unknown or not iOS. */
  iosVersion: number;
  /** Name of the app whose built-in browser this is ("Instagram", "X"…), "this app" when unknown, else null. */
  inApp: string | null;
  /** Running as the installed app right now. */
  standalone: boolean;
  /** Installed from this page load (the `appinstalled` event, or the dialog was accepted). */
  justInstalled: boolean;
  /** standalone || justInstalled */
  installed: boolean;
  /** The browser's one-tap install dialog is ready. */
  canPrompt: boolean;
  /** This browser has install dialogs at all (Chromium). The event may still be on its way. */
  promptSupported: boolean;
  /** Installed from this browser before (it may have been removed since). */
  wasInstalled: boolean;
}

const IN_APP: [RegExp, string][] = [
  [/Instagram/i, "Instagram"],
  [/FBAN|FBAV|FB_IAB|FB4A|FBIOS/, "Facebook"],
  [/Twitter|TwitterAndroid/i, "X"],
  [/Telegram/i, "Telegram"],
  [/musical_ly|TikTok|BytedanceWebview|trill_/i, "TikTok"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Snapchat/i, "Snapchat"],
  [/Pinterest/i, "Pinterest"],
  [/Discord/i, "Discord"],
  [/MicroMessenger/i, "WeChat"],
  [/\bLine\//, "LINE"],
  [/\bGSA\//, "the Google app"],
];

const isIpad = (ua: string) => /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1);

export function detectPlatform(ua = navigator.userAgent): InstallPlatform {
  if (/iPhone|iPod/.test(ua) || isIpad(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function detectBrowser(ua: string): InstallBrowser {
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/EdgiOS|EdgA\/|Edg\//.test(ua)) return "edge";
  if (/OPR\/|OPiOS|OPT\//.test(ua)) return "opera";
  if (/FxiOS|Firefox\//.test(ua)) return "firefox";
  if (/CriOS|Chrome\/|Chromium/.test(ua)) return "chrome";
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return "safari";
  return "other";
}

function detectInApp(ua: string, platform: InstallPlatform): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  // An app's own web view: no "Safari/" token on iOS, "; wv)" on Android.
  if (platform === "ios" && !/Safari\//.test(ua)) return "this app";
  if (platform === "android" && /; wv\)/.test(ua)) return "this app";
  return null;
}

function isStandalone() {
  const mm = (q: string) => !!window.matchMedia?.(`(display-mode: ${q})`).matches;
  return mm("standalone") || mm("fullscreen") || mm("minimal-ui") || mm("window-controls-overlay") || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function readFlag() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1";
  } catch {
    return false;
  }
}

type Fixed = Pick<InstallInfo, "platform" | "browser" | "ipad" | "safariVersion" | "iosVersion" | "inApp" | "promptSupported">;

function readFixed(): Fixed {
  const ua = navigator.userAgent;
  const platform = detectPlatform(ua);
  const browser = detectBrowser(ua);
  const os = /OS (\d+)_(\d+)/.exec(ua);
  const sv = /Version\/(\d+)/.exec(ua);
  return {
    platform,
    browser,
    ipad: isIpad(ua),
    safariVersion: browser === "safari" && sv ? Number(sv[1]) : 0,
    iosVersion: platform === "ios" && os ? Number(os[1]) + Number(os[2]) / 10 : 0,
    inApp: detectInApp(ua, platform),
    promptSupported: "onbeforeinstallprompt" in window,
  };
}

const SERVER: InstallInfo = {
  ready: false,
  platform: "desktop",
  browser: "other",
  ipad: false,
  safariVersion: 0,
  iosVersion: 0,
  inApp: null,
  standalone: false,
  justInstalled: false,
  installed: false,
  canPrompt: false,
  promptSupported: false,
  wasInstalled: false,
};

let fixed: Fixed | null = null;
let snap: InstallInfo | null = null;

function getSnapshot(): InstallInfo {
  fixed ??= readFixed();
  const s = window.__zkInstall;
  const standalone = isStandalone();
  const canPrompt = !!s?.prompt;
  const justInstalled = !!s?.installed;
  // Same object while nothing changed (useSyncExternalStore compares by identity).
  if (snap && snap.standalone === standalone && snap.canPrompt === canPrompt && snap.justInstalled === justInstalled) return snap;
  snap = { ...fixed, ready: true, standalone, canPrompt, justInstalled, installed: standalone || justInstalled, wasInstalled: justInstalled || readFlag() };
  return snap;
}

const getServerSnapshot = () => SERVER;

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.("(display-mode: standalone)");
  window.addEventListener(INSTALL_EVENT, onChange);
  mq?.addEventListener?.("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_EVENT, onChange);
    mq?.removeEventListener?.("change", onChange);
  };
}

/** Show the browser's install dialog. Must run from a tap. Each saved prompt works once. */
export async function promptInstall(): Promise<InstallOutcome> {
  const s = window.__zkInstall;
  const e = s?.prompt;
  if (!s || !e) return "unavailable";
  s.prompt = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    if (outcome === "accepted") {
      s.installed = true;
      try {
        localStorage.setItem(INSTALLED_KEY, "1");
      } catch {}
    }
    return outcome;
  } catch {
    return "unavailable";
  } finally {
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }
}

/** This device's install situation, live. `prompt()` opens the one-tap dialog where there is one. */
export function useInstall() {
  const info = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { ...info, prompt: promptInstall };
}

/** Copy text, with a fallback for in-app browsers without the async clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Android: a link that opens `url` in Chrome from an app's built-in browser (falls back to the same page). */
export function chromeIntent(url: string) {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}
