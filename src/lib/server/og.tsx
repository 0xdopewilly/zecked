// Share-card renderer (1200×630 PNG) for X / Telegram previews. Mirrors design screen 12.
import { ImageResponse } from "next/og";
import type { PublicStash } from "@/lib/types";

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();
function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      (async () => {
        try {
          const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, { signal: AbortSignal.timeout(4000) })).text();
          const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
          if (!url) return null;
          return await (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer();
        } catch {
          return null;
        }
      })()
    );
  }
  return fontCache.get(key)!;
}

const C = {
  bg: "#0E0B1F",
  surface: "#1A1533",
  gold: "#F4B728",
  goldDeep: "#B7820F",
  purple: "#7C5CFF",
  pink: "#FF4D9A",
  mint: "#2EE6A6",
  sky: "#3DB8FF",
  text: "#FFFFFF",
  muted: "#A9A3C9",
};

function zec(zat: number) {
  return (zat / 1e8).toFixed(4).replace(/(\.\d{2}\d*?)0+$/, "$1");
}

/** The size the hider picked, as they picked it: "$5", "$2.50", "$250". */
function dollars(usd: number) {
  return Number.isInteger(usd) || usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
}

export async function shareCard(stash: PublicStash | null, host: string) {
  const [display, body, mono] = await Promise.all([googleFont("Bricolage Grotesque", 800), googleFont("Inter", 700), googleFont("Space Mono", 700)]);
  const fonts = [
    display && { name: "Display", data: display, weight: 800 as const, style: "normal" as const },
    body && { name: "Body", data: body, weight: 700 as const, style: "normal" as const },
    mono && { name: "Mono", data: mono, weight: 700 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 800 | 700; style: "normal" }[];

  const isPred = stash?.type === "prediction";
  const m = stash?.prediction?.match;
  const amount = stash ? `${zec(stash.amountZat)} ZEC` : "";
  const usd = stash ? dollars(stash.usd) : "";
  const zecked = stash?.status === "zecked";
  const ended = zecked || stash?.status === "refunded" || stash?.status === "void" || stash?.status === "expired";
  const headline = !stash
    ? "Hide it. Crack it. Get Zecked."
    : isPred
      ? zecked
        ? `Someone called ${m!.home.code} vs ${m!.away.code} and zecked ${usd}. Call the next one.`
        : stash.prediction!.kind === "exact"
          ? `First to call ${m!.home.code} vs ${m!.away.code} exactly zecks ${usd}`
          : `First to call the ${m!.home.code} vs ${m!.away.code} winner zecks ${usd}`
      : zecked
        ? `Someone zecked ${amount}. Can you crack the next one?`
        : `Crack my riddle and zeck ${amount}. First one wins.`;
  // Live stashes: the prize is checkable. Ended ones say so (a zecked one gets the stamp colour).
  const pill = !stash || stash.status === "live" ? { text: "LIVE · PRIZE VERIFIED", c: C.mint, rgb: "46,230,166" } : zecked ? { text: "ZECKED", c: C.pink, rgb: "255,77,154" } : ended ? { text: "ENDED", c: C.muted, rgb: "169,163,201" } : { text: "NOT LIVE YET", c: C.gold, rgb: "244,183,40" };
  const bgGlow = isPred
    ? `radial-gradient(circle at 100% 0%, rgba(46,230,166,.35), transparent 55%), radial-gradient(circle at 0% 100%, rgba(61,184,255,.45), transparent 55%)`
    : `radial-gradient(circle at 95% 5%, rgba(255,77,154,.5), transparent 55%), radial-gradient(circle at 0% 100%, rgba(124,92,255,.6), transparent 55%)`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: C.bg, backgroundImage: bgGlow, color: C.text, fontFamily: "Body", padding: 64, position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", fontFamily: "Display", fontSize: 54, letterSpacing: -1 }}>
            <span style={{ color: C.gold }}>Z</span>
            <span>ECKED</span>
          </div>
          <div style={{ display: "flex", fontFamily: "Display", fontSize: stash ? 60 : 76, lineHeight: 1.02, maxWidth: 680, letterSpacing: -1.5 }}>{headline}</div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "rgba(26,21,51,.92)",
              border: `2px solid ${isPred ? "rgba(61,184,255,.5)" : "rgba(124,92,255,.55)"}`,
              borderRadius: 28,
              padding: "22px 28px",
              maxWidth: 680,
            }}
          >
            <div style={{ display: "flex", fontSize: 18, color: isPred ? C.sky : C.pink, letterSpacing: 3 }}>{isPred ? "THE MATCH" : stash ? "THE RIDDLE" : "FREE TO PLAY"}</div>
            <div style={{ display: "flex", fontFamily: "Display", fontSize: 30, lineHeight: 1.2, marginTop: 8 }}>
              {isPred && m
                ? `${m.home.name} vs ${m.away.name} · ${m.leagueName}`
                : stash?.riddle
                  ? stash.riddle.text.length > 110
                    ? stash.riddle.text.slice(0, 108) + "…"
                    : stash.riddle.text
                  : "Riddles and match calls with ZEC inside. First one to crack it keeps it."}
            </div>
            {/* Once it's over, the answer is public: the card shows it. */}
            {!isPred && ended && stash?.riddle?.answer ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 12, fontSize: 24 }}>
                <span style={{ color: C.muted }}>The answer was</span>
                <span style={{ fontFamily: "Display", fontSize: 30, color: C.gold }}>{stash.riddle.answer.length > 40 ? stash.riddle.answer.slice(0, 38) + "…" : stash.riddle.answer}</span>
              </div>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", width: 360 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderRadius: 999, background: `rgba(${pill.rgb},.14)`, border: `2px solid rgba(${pill.rgb},.35)`, color: pill.c, fontSize: 20, letterSpacing: 2 }}>
            <div style={{ width: 12, height: 12, borderRadius: 99, background: pill.c }} />
            {pill.text}
          </div>
          {stash && (
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
              }}
            >
              {isPred && m ? (
                <div style={{ display: "flex", gap: 14, alignItems: "center", fontFamily: "Display", fontSize: 44 }}>
                  <div style={{ display: "flex", width: 84, height: 84, borderRadius: 99, background: m.home.color, color: m.home.ink, alignItems: "center", justifyContent: "center", fontSize: 26, border: "4px solid #fff" }}>{m.home.code}</div>
                  <span>vs</span>
                  <div style={{ display: "flex", width: 84, height: 84, borderRadius: 99, background: m.away.color, color: m.away.ink, alignItems: "center", justifyContent: "center", fontSize: 26, border: "4px solid #fff" }}>{m.away.code}</div>
                </div>
              ) : (
                <div style={{ display: "flex", fontSize: 80 }}>🔐</div>
              )}
              <div style={{ display: "flex", fontFamily: "Mono", fontSize: 44, marginTop: 14 }}>{amount}</div>
              <div style={{ display: "flex", fontSize: 24, marginTop: 4 }}>{zecked ? `${usd} stash · zecked` : `${usd} inside`}</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
            <div style={{ display: "flex", background: "#fff", color: C.bg, fontFamily: "Mono", fontSize: 26, padding: "12px 22px", borderRadius: 18 }}>{stash ? `${host}/s/${stash.id}` : host}</div>
            <div style={{ display: "flex", fontSize: 18, color: C.muted }}>{stash?.testMode ? "Test ZEC · no real value" : "Free to play"} · Built on Zcash</div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts, emoji: "twemoji" }
  );
}
