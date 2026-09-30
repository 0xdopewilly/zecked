"use client";
// Profile photo on /me: the tappable avatar, its menu (choose from gallery · remove photo · guests: sign up)
// and the crop sheet (drag to move, pinch or slide to zoom, round mask). The crop is made on the phone as
// a 320×320 JPEG, so uploads stay tiny (and Safari can't reliably encode WebP).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { Player } from "@/lib/types";
import { Avatar, Button, Icon } from "@/components/zk";
import { TopToast } from "@/components/screens/WinMoment";

const OUT = 320; // exported photo size (px)
const MAX_ZOOM = 4;
const MASK = 0.86; // the crop circle's share of the stage
const WORK_MAX = 1600; // longest side of the copy we crop from (a 12MP photo would be slow to move)
const MAX_FILE = 40 * 1024 * 1024;

/** Friendly copy for a failed request: never the raw browser text. */
function friendlyErr(e: unknown, fallback: string): string {
  const status = (e as { status?: number } | null)?.status;
  if (status == null) return "Can’t reach ZECKED. Check your connection and try again.";
  if (status >= 500) return fallback;
  const m = e instanceof Error ? e.message : "";
  return m && !/^Request failed/i.test(m) ? (/[.!?]$/.test(m) ? m : `${m}.`) : fallback;
}

/* ---------- decoding + export ---------- */

/** Decode a picked photo, upright (EXIF), into `canvas`, at most WORK_MAX px on its longest side. */
async function decodeInto(file: File, canvas: HTMLCanvasElement) {
  let src: CanvasImageSource;
  let w = 0;
  let h = 0;
  let done = () => {};
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    [src, w, h, done] = [bmp, bmp.width, bmp.height, () => bmp.close()];
  } catch {
    // Older Safari/Firefox: an <img> applies EXIF orientation by itself (and Safari decodes HEIC).
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } finally {
      done = () => URL.revokeObjectURL(url);
    }
    [src, w, h] = [img, img.naturalWidth, img.naturalHeight];
  }
  try {
    if (!w || !h) throw new Error("empty image");
    const k = Math.min(1, WORK_MAX / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * k));
    canvas.height = Math.max(1, Math.round(h * k));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  } finally {
    done();
  }
}

const blank = (n: number) => Object.assign(document.createElement("canvas"), { width: n, height: n });

/** The square under the circle, as a 320×320 JPEG (halving first, so big downscales stay sharp). */
async function exportCrop(work: HTMLCanvasElement, sx: number, sy: number, side: number): Promise<Blob> {
  let src: CanvasImageSource = work;
  let [x, y, s] = [sx, sy, side];
  while (s > OUT * 2) {
    const t = blank(Math.round(s / 2));
    const c = t.getContext("2d")!;
    c.imageSmoothingQuality = "high";
    c.drawImage(src, x, y, s, s, 0, 0, t.width, t.height);
    [src, x, y, s] = [t, 0, 0, t.width];
  }
  const out = blank(OUT);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#0E0B1F"; // under any transparent bits (JPEG has no alpha)
  ctx.fillRect(0, 0, OUT, OUT);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, x, y, s, s, 0, 0, OUT, OUT);
  const jpeg = (q: number) => new Promise<Blob | null>((res) => out.toBlob(res, "image/jpeg", q));
  let blob = await jpeg(0.85);
  if (blob && blob.size > 180_000) blob = await jpeg(0.7);
  if (!blob) throw new Error("export failed");
  return blob;
}

/* ---------- sheet ---------- */

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      onClick={() => close.current()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgb(var(--zk-black-rgb) / .6)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        animation: "zk-vt-fade-in var(--zk-dur-base) var(--zk-ease-out) both",
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 430,
          maxHeight: "100dvh",
          overflowY: "auto",
          overscrollBehavior: "contain",
          boxSizing: "border-box",
          outline: "none",
          background: "var(--zk-surface)",
          borderRadius: "var(--zk-radius-3xl) var(--zk-radius-3xl) 0 0",
          border: "2.5px solid var(--zk-ink)",
          borderBottom: 0,
          boxShadow: "var(--zk-shadow-float)",
          padding: "var(--zk-space-20) var(--zk-space-18) calc(env(safe-area-inset-bottom, 0px) + var(--zk-space-18))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--zk-space-14)",
          color: "var(--zk-text)",
          fontFamily: "var(--zk-font-body)",
          animation: "zk-vt-rise var(--zk-dur-base) var(--zk-ease-out) both",
        }}
      >
        <div aria-hidden="true" style={{ alignSelf: "center", width: 40, height: 4, borderRadius: 2, background: "var(--zk-border-strong)", marginTop: -6, flex: "none" }} />
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- crop ---------- */

type View = { x: number; y: number; s: number; min: number; S: number };

function CropSheet({ file, onCancel, onSave }: { file: File; onCancel: () => void; onSave: (photo: Blob) => void }) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const view = useRef<View>({ x: 0, y: 0, s: 1, min: 1, S: 0 });

  // Keep the circle covered: the photo can't be dragged or zoomed out past its edges.
  const apply = useCallback(() => {
    const c = canvasRef.current;
    const v = view.current;
    if (!c || !v.S) return;
    const D = v.S * MASK;
    const c0 = (v.S - D) / 2;
    v.s = Math.min(v.min * MAX_ZOOM, Math.max(v.min, v.s));
    v.x = Math.min(c0, Math.max(c0 + D - c.width * v.s, v.x));
    v.y = Math.min(c0, Math.max(c0 + D - c.height * v.s, v.y));
    c.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.s})`;
    if (sliderRef.current) sliderRef.current.value = String(v.s / v.min);
  }, []);

  const zoomAt = useCallback(
    (next: number, fx: number, fy: number) => {
      const v = view.current;
      const s2 = Math.min(v.min * MAX_ZOOM, Math.max(v.min, next));
      v.x = fx - (fx - v.x) * (s2 / v.s);
      v.y = fy - (fy - v.y) * (s2 / v.s);
      v.s = s2;
      apply();
    },
    [apply],
  );

  // Fit: the photo's short side fills the circle, centred.
  const fit = useCallback(() => {
    const c = canvasRef.current;
    const st = stageRef.current;
    if (!c || !st || !c.width) return;
    const S = st.clientWidth;
    const v = view.current;
    const zoom = v.S ? v.s / v.min : 1;
    v.S = S;
    v.min = (S * MASK) / Math.min(c.width, c.height);
    v.s = v.min * zoom;
    v.x = (S - c.width * v.s) / 2;
    v.y = (S - c.height * v.s) / 2;
    apply();
  }, [apply]);

  useEffect(() => {
    let alive = true;
    const c = canvasRef.current!;
    decodeInto(file, c)
      .then(() => {
        if (!alive) return;
        c.style.width = `${c.width}px`;
        c.style.height = `${c.height}px`;
        setPhase("ready");
      })
      .catch(() => alive && setPhase("error"));
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    if (phase !== "ready") return;
    const st = stageRef.current!;
    fit();
    const ro = new ResizeObserver(() => st.clientWidth !== view.current.S && fit());
    ro.observe(st);
    // Pinch/wheel belong to the photo, not the page (Safari's gesture events, desktop trackpads).
    const stop = (e: Event) => e.preventDefault();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoomAt(view.current.s * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - st.clientLeft, e.clientY - r.top - st.clientTop);
    };
    st.addEventListener("gesturestart", stop);
    st.addEventListener("gesturechange", stop);
    st.addEventListener("wheel", wheel, { passive: false });
    return () => {
      ro.disconnect();
      st.removeEventListener("gesturestart", stop);
      st.removeEventListener("gesturechange", stop);
      st.removeEventListener("wheel", wheel);
    };
  }, [phase, fit, zoomAt]);

  // Pointers: one finger drags, two pinch (and drag by their midpoint).
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ x: number; y: number; d: number } | null>(null);
  const gesture = () => {
    const p = [...pts.current.values()];
    const x = p.reduce((s, q) => s + q.x, 0) / p.length;
    const y = p.reduce((s, q) => s + q.y, 0) / p.length;
    const d = p.length > 1 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
    return { x, y, d };
  };
  const local = (e: ReactPointerEvent) => {
    const st = stageRef.current!;
    const r = st.getBoundingClientRect();
    return { x: e.clientX - r.left - st.clientLeft, y: e.clientY - r.top - st.clientTop };
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== "ready") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, local(e));
    last.current = gesture();
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, local(e));
    const g = gesture();
    const l = last.current;
    if (l) {
      const v = view.current;
      v.x += g.x - l.x;
      v.y += g.y - l.y;
      if (g.d && l.d) zoomAt(v.s * (g.d / l.d), g.x, g.y);
      else apply();
    }
    last.current = g;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pts.current.delete(e.pointerId);
    last.current = pts.current.size ? gesture() : null;
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 12;
    const d = ({ ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return;
    e.preventDefault();
    view.current.x += d[0];
    view.current.y += d[1];
    apply();
  };
  const zoomBy = (k: number) => {
    const v = view.current;
    zoomAt(v.s * k, v.S / 2, v.S / 2);
  };

  const save = async () => {
    const c = canvasRef.current;
    const v = view.current;
    if (!c || busy || phase !== "ready") return;
    setBusy(true);
    try {
      const D = v.S * MASK;
      const c0 = (v.S - D) / 2;
      onSave(await exportCrop(c, (c0 - v.x) / v.s, (c0 - v.y) / v.s, D / v.s));
    } catch {
      setBusy(false);
      setPhase("error");
    }
  };

  return (
    <Sheet label="Move and zoom your photo" onClose={busy ? () => {} : onCancel}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-4)", textAlign: "center" }}>
        <div aria-hidden="true" style={{ font: "var(--zk-type-h3)" }}>
          Move and zoom
        </div>
        <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)" }}>Drag your photo into the circle. Pinch or slide to zoom.</div>
      </div>
      <div
        ref={stageRef}
        role="img"
        aria-label="Your photo. Drag or use the arrow keys to move it"
        tabIndex={phase === "ready" ? 0 : -1}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        style={{
          position: "relative",
          width: "min(100%, 320px)",
          aspectRatio: "1",
          alignSelf: "center",
          flex: "none",
          overflow: "hidden",
          borderRadius: "var(--zk-radius-2xl)",
          background: "var(--zk-ink)",
          border: "2.5px solid var(--zk-ink)",
          boxSizing: "border-box",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          cursor: phase === "ready" ? "grab" : "default",
          outlineOffset: 3,
        } as CSSProperties}
      >
        <canvas
          ref={canvasRef}
          width={1}
          height={1}
          style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", willChange: "transform", pointerEvents: "none", opacity: phase === "ready" ? 1 : 0 }}
        />
        {/* The round mask: everything outside the circle is dimmed. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: `${((1 - MASK) / 2) * 100}%`,
            borderRadius: "50%",
            boxShadow: "0 0 0 2.5px var(--zk-text), 0 0 0 999px rgb(7 5 26 / .62)",
            pointerEvents: "none",
          }}
        />
        {phase !== "ready" && (
          <div
            role="status"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--zk-space-10)",
              padding: "var(--zk-space-24)",
              textAlign: "center",
              font: "var(--zk-type-small)",
              color: "var(--zk-text-muted)",
            }}
          >
            {phase === "loading" ? (
              <>
                <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid var(--zk-border-strong)", borderTopColor: "var(--zk-gold)", animation: "zk-spin .8s linear infinite" }} />
                Opening your photo…
              </>
            ) : (
              <>
                <Icon icon="camera" size={26} stroke={2.4} />
                Couldn’t open that photo. Try a different one.
              </>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-6)", opacity: phase === "ready" ? 1 : 0.4 }}>
        <button type="button" aria-label="Zoom out" disabled={phase !== "ready"} onClick={() => zoomBy(1 / 1.25)} style={roundBtn}>
          <Icon icon="minus" size={16} stroke={2.8} />
        </button>
        <input
          ref={sliderRef}
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          defaultValue={1}
          disabled={phase !== "ready"}
          aria-label="Zoom"
          onInput={(e) => {
            const v = view.current;
            zoomAt(v.min * Number(e.currentTarget.value), v.S / 2, v.S / 2);
          }}
          style={{ flex: 1, minWidth: 0, height: 44, margin: 0, accentColor: "var(--zk-gold)", cursor: "pointer" }}
        />
        <button type="button" aria-label="Zoom in" disabled={phase !== "ready"} onClick={() => zoomBy(1.25)} style={roundBtn}>
          <Icon icon="plus" size={16} stroke={2.8} />
        </button>
      </div>
      <div style={{ display: "flex", gap: "var(--zk-space-10)" }}>
        <div style={{ flex: 1 }}>
          <Button label="Cancel" variant="ghost" size="md" disabled={busy} onClick={onCancel} sfx="none" />
        </div>
        <div style={{ flex: 1.4 }}>
          <Button
            label={busy ? "Saving…" : "Save photo"}
            icon={busy ? undefined : "check"}
            variant="primary"
            size="md"
            disabled={busy || phase !== "ready"}
            sfx="success"
            onClick={() => void save()}
          />
        </div>
      </div>
    </Sheet>
  );
}

const roundBtn: CSSProperties = {
  width: 44,
  height: 44,
  flex: "none",
  borderRadius: "50%",
  border: 0,
  padding: 0,
  background: "var(--zk-surface-raised)",
  color: "var(--zk-text)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  touchAction: "manipulation",
};

/* ---------- menu ---------- */

function PhotoMenu({
  player,
  hasPhoto,
  onPick,
  onRemove,
  onClose,
}: {
  player: Player;
  hasPhoto: boolean;
  onPick: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const signedIn = !!player.account?.signedIn;
  return (
    <Sheet label={signedIn ? "Your photo" : "Add a photo"} onClose={onClose}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--zk-space-14)" }}>
        <Avatar handle={player.handle} src={hasPhoto ? player.avatarUrl : null} size={64} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--zk-space-4)" }}>
          <div style={{ font: "var(--zk-type-h3)" }}>{signedIn ? (hasPhoto ? "Your photo" : "Add your photo") : "Meet your buddy"}</div>
          <div style={{ font: "var(--zk-type-caption)", color: "var(--zk-text-muted)", textWrap: "pretty" } as CSSProperties}>
            {signedIn
              ? "It shows on the leaderboard and your public page."
              : "Every player gets one. Sign up to swap it for your own photo. Your XP and badges come with you."}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--zk-space-10)", marginTop: "var(--zk-space-4)" }}>
        {signedIn ? (
          <>
            <Button label="Choose from gallery" icon="camera" variant="primary" size="md" onClick={onPick} />
            {hasPhoto && <Button label="Remove photo" variant="ghost" size="md" sfx="whoosh" onClick={onRemove} style={{ color: "var(--zk-red-soft)" }} />}
          </>
        ) : (
          <Button label="Sign up to add a photo" icon="camera" variant="primary" size="md" href="/signin?next=%2Fme" />
        )}
        <Button label={signedIn ? "Cancel" : "Not now"} variant="ghost" size="md" sfx="none" onClick={onClose} />
      </div>
    </Sheet>
  );
}

/* ---------- the avatar button ---------- */

/** Your avatar on /me. Tap it to add, change or remove your photo. `handle` can be a live draft. */
export function AvatarPhoto({ player, handle, size, onSaved }: { player: Player; handle: string; size: string | number; onSaved: (p: Player) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Optimistic photo while saving: a local blob URL, or null while a removal is on its way.
  const [pending, setPending] = useState<{ src: string | null } | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean; n: number } | null>(null);
  const saving = pending != null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  const say = (text: string, ok: boolean) => setToast((t) => ({ text, ok, n: (t?.n ?? 0) + 1 }));

  const src = pending ? pending.src : player.avatarUrl || null;

  const pick = () => {
    inputRef.current?.click(); // still inside the tap, so phones open the photo picker
    setMenu(false);
  };
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // picking the same photo again still fires
    if (!f) return;
    if (f.type && !f.type.startsWith("image/")) return say("That file isn’t a photo. Pick a picture from your gallery.", false);
    if (f.size > MAX_FILE) return say("That photo is too big. Try a different one.", false);
    setFile(f);
  };

  const upload = async (photo: Blob) => {
    setFile(null);
    const local = URL.createObjectURL(photo);
    setPending({ src: local });
    try {
      const { player: p } = await api.uploadAvatar(photo);
      // Load the real one before swapping, so the photo doesn't blink.
      if (p.avatarUrl) {
        const img = new Image();
        img.src = p.avatarUrl;
        await img.decode().catch(() => {});
      }
      onSaved(p);
      say("Looking good! That’s your new photo.", true);
    } catch (e) {
      say(friendlyErr(e, "Couldn’t save your photo. Try again."), false);
    } finally {
      setPending(null);
      URL.revokeObjectURL(local);
    }
  };

  const remove = async () => {
    setMenu(false);
    setPending({ src: null });
    try {
      const { player: p } = await api.removeAvatar();
      onSaved(p);
      say("Photo removed. Your buddy is back.", true);
    } catch (e) {
      say(friendlyErr(e, "Couldn’t remove your photo. Try again."), false);
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => !saving && setMenu(true)}
        aria-label={saving ? "Saving your photo" : player.avatarUrl ? "Change your photo" : "Add a profile photo"}
        aria-busy={saving || undefined}
        style={{
          position: "relative",
          width: size,
          height: size,
          flex: "none",
          padding: 0,
          border: 0,
          borderRadius: "50%",
          background: "transparent",
          cursor: "pointer",
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <Avatar handle={handle} src={src} size="100%" style={{ opacity: saving ? 0.7 : 1, transition: "opacity var(--zk-dur-fast) var(--zk-ease-out)" }} />
        {saving ? (
          <span
            aria-hidden="true"
            style={{ position: "absolute", inset: -4, borderRadius: "50%", border: "3px solid transparent", borderTopColor: "var(--zk-gold)", animation: "zk-spin .8s linear infinite" }}
          />
        ) : (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              right: -4,
              bottom: -3,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--zk-gold)",
              color: "var(--zk-gold-ink)",
              border: "2px solid var(--zk-ink)",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon="camera" size={12} stroke={2.6} />
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={picked}
        style={{ position: "fixed", left: -9999, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
      />
      {menu && <PhotoMenu player={player} hasPhoto={!!player.avatarUrl} onPick={pick} onRemove={() => void remove()} onClose={() => setMenu(false)} />}
      {file && <CropSheet file={file} onCancel={() => setFile(null)} onSave={(b) => void upload(b)} />}
      {toast && <TopToast key={toast.n} text={toast.text} variant={toast.ok ? "success" : "error"} icon={toast.ok ? "camera" : undefined} zIndex={95} />}
    </>
  );
}
