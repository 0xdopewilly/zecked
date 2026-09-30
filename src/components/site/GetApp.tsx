"use client";
// "Get the app" on the website. A home-screen app can only be installed from its own site, so on phones this
// is a plain link to the app's /install page (it shows the right steps for that phone); on computers it opens
// a QR code to scan with the phone. The QR dialog, and the QR library, load only when someone opens it.
import dynamic from "next/dynamic";
import { useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { detectPlatform } from "@/lib/install";

const GetAppModal = dynamic(() => import("./GetAppModal"), { ssr: false });
const warm = () => void import("./GetAppModal");

export function GetAppButton({
  appUrl,
  className,
  style,
  children,
  onPointerEnter,
  onPointerDown,
}: {
  appUrl: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onPointerEnter?: (e: PointerEvent<HTMLAnchorElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLAnchorElement>) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <a
        href={`${appUrl}/install`}
        className={className}
        style={style}
        onClick={(e) => {
          // New-tab clicks and phones/tablets just follow the link.
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          if (detectPlatform() !== "desktop") return;
          e.preventDefault();
          setOpen(true);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") warm();
          onPointerEnter?.(e);
        }}
        onPointerDown={onPointerDown}
        onFocus={warm}
      >
        {children}
      </a>
      {open && <GetAppModal appUrl={appUrl} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A phone with a download arrow, sized like the zk Icon set. */
export function PhoneGlyph({ size = 20, stroke = 2.4 }: { size?: number; stroke?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <path d="M8 2.5h8A1.5 1.5 0 0 1 17.5 4v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z M12 7.5v7 M9.5 12l2.5 2.5 2.5-2.5 M11 18.5h2" />
    </svg>
  );
}
