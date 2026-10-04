// Share-card renderer (1200×630 PNG) for a gift link (/g/<id>): "You've got a ZECKED gift". WhatsApp and
// Telegram servers fetch this, so it never shows the amount, the message or the question: only who it's
// from, whether it's locked, and whether it's still waiting.
import { ImageResponse } from "next/og";
import { C, googleFont } from "./og";

export interface GiftCardInfo {
  id: string;
  fromHandle: string;
  locked: boolean;
  status: "open" | "claimed" | "returned" | "cancelled";
  testMode: boolean;
}

export async function giftCard(gift: GiftCardInfo | null, host: string) {
  const [display, body, mono] = await Promise.all([googleFont("Bricolage Grotesque", 800), googleFont("Inter", 700), googleFont("Space Mono", 700)]);
  const fonts = [
    display && { name: "Display", data: display, weight: 800 as const, style: "normal" as const },
    body && { name: "Body", data: body, weight: 700 as const, style: "normal" as const },
    mono && { name: "Mono", data: mono, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 800 | 700; style: "normal" }[];

  const open = gift?.status === "open";
  const pill = !gift
    ? { text: "GIFTS ON ZECKED", c: C.pink, rgb: "255,77,154" }
    : open
      ? { text: gift.locked ? "LOCKED · OPEN IT" : "OPEN IT", c: C.mint, rgb: "46,230,166" }
      : gift.status === "claimed"
        ? { text: "OPENED", c: C.pink, rgb: "255,77,154" }
        : { text: "RETURNED", c: C.muted, rgb: "169,163,201" };
  const headline = !gift ? "Send a friend ZEC. Lock it with a question only they can answer." : open ? "You've got a ZECKED gift" : gift.status === "claimed" ? "This gift was opened" : "This gift went back to its sender";
  const sub = !gift
    ? "Gifts are opened from a link and land in a private ZECKED wallet."
    : gift.locked
      ? `Locked with a question only you can answer. Open the link to try.`
      : `Open the link and it lands in your ZECKED wallet.`;
  const bgGlow = `radial-gradient(circle at 95% 5%, rgba(255,77,154,.5), transparent 55%), radial-gradient(circle at 0% 100%, rgba(244,183,40,.45), transparent 55%)`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.bg, backgroundImage: bgGlow, color: C.text, fontFamily: "Body", padding: 64, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Display", fontSize: 54, letterSpacing: -1 }}>
            <span style={{ color: C.gold }}>Z</span>
            <span>ECKED</span>
          </div>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: gift ? 64 : 58, lineHeight: 1.02, maxWidth: 680, letterSpacing: -1.5 }}>{headline}</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "rgba(26,21,51,.92)",
              border: "2px solid rgba(255,77,154,.5)",
              borderRadius: 28,
              padding: "22px 28px",
              maxWidth: 680,
            }}
          >
            <div style={{ display: "flex", fontSize: 18, color: C.pink, letterSpacing: 3 }}>{gift ? `FROM ${gift.fromHandle.toUpperCase()}` : "HOW IT WORKS"}</div>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 30, lineHeight: 1.2, marginTop: 8 }}>{sub}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", width: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999, background: `rgba(${pill.rgb},.14)`, border: `2px solid rgba(${pill.rgb},.35)`, color: pill.c, fontSize: 20, letterSpacing: 2 }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: pill.c }} />
            {pill.text}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              width: 300,
              height: 280,
              borderRadius: 44,
              background: `linear-gradient(160deg, #FFD978 0%, ${C.gold} 55%, #E09A12 100%)`,
              boxShadow: `0 14px 0 ${C.goldDeep}`,
              color: "#3A2600",
              transform: "rotate(4deg)",
              opacity: gift && !open ? 0.75 : 1,
            }}
          >
            <div style={{ display: "flex", fontSize: 92 }}>{gift?.locked && open ? "🔐" : "🎁"}</div>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 40, marginTop: 10 }}>A gift</div>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 40 }}>for you.</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <div style={{ display: "flex", background: "#fff", color: C.bg, fontFamily: "Mono", fontSize: 26, padding: "12px 22px", borderRadius: 18 }}>{gift ? `${host}/g/${gift.id}` : host}</div>
            <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{gift?.testMode !== false ? "Test ZEC · no real value" : "Private by default"} · Built on Zcash</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, emoji: "twemoji" }
  );
}
