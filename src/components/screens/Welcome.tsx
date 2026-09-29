"use client";
// Screen 01 · Welcome. Vault door loop, floating stickers, wordmark, tagline and the "Start zecking" CTA.
import Link from "next/link";
import type { CSSProperties } from "react";
import { Button, Icon, Logo, TeamBadge, Vault } from "@/components/zk";
import { DEMO_BARCELONA } from "@/lib/crest";

const sticker: CSSProperties = {
  position: "absolute",
  display: "flex",
  alignItems: "center",
  gap: "var(--zk-space-6)",
  padding: "var(--zk-space-8) var(--zk-space-12)",
  borderRadius: "var(--zk-radius-lg)",
  font: "var(--zk-type-btn-sm)",
  whiteSpace: "nowrap",
  zIndex: 2,
};

// The art box mirrors the design's 390px phone: vault top sits at VT, stickers are offset from it.
const VT = 28;

export default function Welcome() {
  return (
    <main
      className="zk-screen"
      style={{ background: "var(--zk-bg-welcome)", overflow: "hidden", paddingLeft: 0, paddingRight: 0 }}
    >
      <div
        style={{
          flex: "1 0 auto",
          minHeight: 330,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ position: "relative", width: "100%", maxWidth: 390, height: 320, margin: "0 auto" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              marginLeft: -255,
              top: VT - 60,
              width: 510,
              height: 510,
              borderRadius: "50%",
              background: "var(--zk-sunburst-gold)",
              willChange: "transform",
              animation: "zk-spin 40s linear infinite",
            }}
          />
          <div style={{ position: "absolute", left: "50%", marginLeft: -130, top: VT, zIndex: 1 }}>
            <Vault mode="loop" size={260} />
          </div>
          <div
            aria-hidden="true"
            style={
              {
                ...sticker,
                left: 18,
                top: VT - 12,
                "--zk-tilt": "-8deg",
                animation: "zk-bob 3.2s ease-in-out infinite",
                background: "var(--zk-pink)",
                color: "var(--zk-text)",
                boxShadow: "var(--zk-shadow-sticker-pink)",
              } as CSSProperties
            }
          >
            <Icon icon="unlock" size={15} stroke={2.6} />
            +0.02 ZEC
          </div>
          <div
            aria-hidden="true"
            style={
              {
                ...sticker,
                right: 16,
                top: VT + 50,
                "--zk-tilt": "7deg",
                animation: "zk-bob 3.8s ease-in-out .4s infinite",
                background: "var(--zk-sky)",
                color: "var(--zk-sky-ink)",
                boxShadow: "var(--zk-shadow-sticker-sky)",
              } as CSSProperties
            }
          >
            <TeamBadge {...DEMO_BARCELONA} size={20} />
            BAR 2–1?
          </div>
          <div
            aria-hidden="true"
            style={
              {
                ...sticker,
                right: 30,
                top: VT + 250,
                "--zk-tilt": "-5deg",
                animation: "zk-bob 3.4s ease-in-out .9s infinite",
                background: "var(--zk-mint)",
                color: "var(--zk-mint-ink)",
                boxShadow: "var(--zk-shadow-sticker-mint)",
              } as CSSProperties
            }
          >
            <Icon icon="key" size={15} stroke={2.4} />
            38 tries
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: "auto",
          position: "relative",
          zIndex: 3,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--zk-space-40)",
          padding: "0 var(--zk-space-24) var(--zk-space-24)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-16)",
            textAlign: "center",
          }}
        >
          <Logo variant="wordmark" size={58} />
          <h1 style={{ margin: 0, font: "var(--zk-fw-black) var(--zk-fs-22)/1.2 var(--zk-font-display)" }}>
            Hide it. Crack it. <span style={{ color: "var(--zk-gold)" }}>Get Zecked.</span>
          </h1>
          <p
            style={{
              margin: 0,
              font: "var(--zk-type-body)",
              fontSize: "var(--zk-fs-15)",
              color: "var(--zk-text-muted)",
              maxWidth: 300,
              textWrap: "pretty",
            }}
          >
            Riddles and match calls with real ZEC inside. First one to crack it keeps it.
          </p>
        </div>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--zk-space-14)",
          }}
        >
          <div style={{ width: "100%" }}>
            <Button label="Start zecking" variant="primary" size="lg" iconRight="arrowRight" full href="/feed" />
          </div>
          <span style={{ font: "var(--zk-type-small)", color: "var(--zk-text-muted)" }}>
            Free to play · No sign-up needed
          </span>
          <Link
            href="/how"
            style={{
              font: "var(--zk-type-small)",
              color: "var(--zk-gold)",
              textDecoration: "underline",
              textUnderlineOffset: 3,
              minHeight: "var(--zk-tap-min)",
              marginTop: "calc(-1 * var(--zk-space-10))",
              marginBottom: "calc(-1 * var(--zk-space-10))",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 var(--zk-space-8)",
            }}
          >
            How it works
          </Link>
          <span
            style={{
              font: "var(--zk-fw-medium) var(--zk-fs-11)/1 var(--zk-font-body)",
              color: "var(--zk-text-faint)",
              letterSpacing: ".04em",
            }}
          >
            Built on Zcash
          </span>
        </div>
      </div>
    </main>
  );
}
