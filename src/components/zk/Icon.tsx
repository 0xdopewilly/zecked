import type { CSSProperties } from "react";

/* Port of "ZK Icon": 46 icons on a 24px grid, 2px round strokes, one SVG path in currentColor. */

const C = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const I = {
  lock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V7a4 4 0 0 1 8 0v4", "M12 15v2"],
  unlock: ["M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z", "M8 11V7a4 4 0 0 1 7.8-1.3", "M12 15v2"],
  key: [C(7.5, 15.5, 3.5), "M10 13l9-9", "M16 7l2 2", "M13.5 9.5l2 2"],
  passkey: [
    "M3.6 9.8a8.8 8.8 0 0 1 16.8 0",
    "M5.3 17.8c.6-1.5.9-3.1.9-4.8a5.8 5.8 0 0 1 11.6 0c0 2.3-.3 4.5-.9 6.6",
    "M8 20.5c.8-2 1.2-4.2 1.2-6.5a2.8 2.8 0 0 1 5.6 0c0 1.2-.1 2.4-.3 3.5",
    "M12 14c0 2.6-.5 5-1.4 7.2",
  ],
  ball: [C(12, 12, 9), "M12 7.5l3.8 2.8-1.5 4.5H9.7l-1.5-4.5z", "M12 7.5V3.2", "M15.8 10.3l4.1-1.3", "M14.3 14.8l2.5 3.6", "M9.7 14.8l-2.5 3.6", "M8.2 10.3L4.1 9"],
  share: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  back: ["M15 5l-7 7 7 7"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 5v14", "M5 12h14"],
  minus: ["M5 12h14"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  arrowRight: ["M5 12h14", "M13 6l6 6-6 6"],
  arrowUp: ["M12 19V5", "M6 11l6-6 6 6"],
  search: [C(11, 11, 7), "M20 20l-4-4"],
  bulb: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8v.3h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"],
  flame: ["M12 3c1 3 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-5 1 1.5 2 2 3 2-1-2.5-.5-5 0-7z"],
  trophy: ["M8 4h8v5a4 4 0 0 1-8 0z", "M8 6H5a3 3 0 0 0 3 4", "M16 6h3a3 3 0 0 1-3 4", "M12 13v4", "M8 21h8", "M9 17h6v4H9z"],
  home: ["M4 11l8-7 8 7", "M6 9.5V20h12V9.5", "M10 20v-5h4v5"],
  user: [C(12, 8, 4), "M4 21a8 8 0 0 1 16 0"],
  vault: ["M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z", C(12, 12, 4), "M12 8v1.5", "M12 14.5V16", "M8 12h1.5", "M14.5 12H16", "M7 20v1.5", "M17 20v1.5"],
  wallet: ["M4 6a2 2 0 0 1 2-2h11v3", "M4 6v12a2 2 0 0 0 2 2h14V8H6a2 2 0 0 1-2-2z", "M16 14h.01"],
  bolt: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  shield: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"],
  shieldCheck: ["M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M9 12l2 2 4-4"],
  orb: [C(12, 10.5, 6.5), "M7 21h10l-1.5-3.5h-7z", "M9.5 8.5a2.5 2.5 0 0 1 2.5-2"],
  eye: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z", C(12, 12, 3)],
  eyeOff: ["M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z", C(12, 12, 3), "M4 4l16 16"],
  hourglass: ["M6 3h12", "M6 21h12", "M7 3c0 4 4 6 5 9-1 3-5 5-5 9", "M17 3c0 4-4 6-5 9 1 3 5 5 5 9"],
  clip: ["M16 7l-6.5 6.5a2 2 0 0 0 2.8 2.8L19 9.6a4 4 0 0 0-5.7-5.7L6.6 10.6a6 6 0 0 0 8.5 8.5L20 14"],
  dial: [C(12, 12, 8), "M12 4v2", "M20 12h-2", "M12 20v-2", "M4 12h2", "M12 12l3-4"],
  crown: ["M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"],
  whale: ["M3 13c0 4 4 6 9 6 5 0 9-3 9-8 0-1-.6-2-1.5-2S18 10 17 11c-1.5-2-4-3-7-3-4 0-7 2-7 5z", "M8 13h.01", "M10 5c0-1 .8-2 2-2", "M10 5c0-1-.8-2-2-2"],
  mask: ["M3 10c3-2 15-2 18 0v3.5c-3 2-15 2-18 0z", "M7.5 11.8h2.5", "M14 11.8h2.5", "M21 11l1.5-2"],
  cake: ["M4 20h16", "M5 20v-7h14v7", "M5 15.5c2 1.5 4.5 1.5 7 0s5-1.5 7 0", "M12 13V9.5", "M12 7c.8-.8.8-1.7 0-2.5-.8.8-.8 1.7 0 2.5z"],
  sliders: ["M4 7h10", "M18 7h2", "M16 5v4", "M4 17h4", "M12 17h8", "M10 15v4"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  signal: ["M12 12h.01", "M8.5 8.5a5 5 0 0 0 0 7", "M15.5 8.5a5 5 0 0 1 0 7", "M5.5 5.5a9 9 0 0 0 0 13", "M18.5 5.5a9 9 0 0 1 0 13"],
  medal: [C(12, 15, 5), "M9 10.5L6 3h4l2 4 2-4h4l-3 7.5"],
  target: [C(12, 12, 9), C(12, 12, 5), C(12, 12, 1)],
  flag: ["M5 21V4", "M5 4h12l-2 4 2 4H5"],
  flashlight: ["M8 2h8v5l-2 3v12h-4V10L8 7z", "M12 13v2"],
  camera: ["M4 8h3l2-3h6l2 3h3v11H4z", C(12, 13, 3.5)],
  clock: [C(12, 12, 9), "M12 7v5l3 2"],
  coin: [C(12, 12, 9), "M9 8.5h6l-6 7h6"],
  sparkle: ["M12 3v4", "M12 17v4", "M3 12h4", "M17 12h4", "M6 6l2.5 2.5", "M15.5 15.5L18 18", "M18 6l-2.5 2.5", "M8.5 15.5L6 18"],
  info: [C(12, 12, 9), "M12 11v5", "M12 8h.01"],
  bell: ["M6 16V11a6 6 0 0 1 12 0v5l2 2H4z", "M10 21h4"],
} satisfies Record<string, string[]>;

export type IconName = keyof typeof I;

/** Every icon name, in design order. */
export const ICON_NAMES = Object.keys(I) as IconName[];

export function isIconName(name: unknown): name is IconName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(I, name);
}

/** Any string is accepted (unknown names fall back to "lock", as in the design); IconName gives autocomplete. */
export type IconProp = IconName | (string & {});

export interface IconProps {
  icon?: IconProp;
  size?: number;
  stroke?: number;
  color?: string;
  filled?: boolean;
  /** When set, the icon is announced as an image with this label; otherwise it is aria-hidden. */
  title?: string;
  style?: CSSProperties;
  className?: string;
}

export function Icon({ icon = "lock", size, stroke, color, filled = false, title, style, className }: IconProps) {
  const d = (isIconName(icon) ? I[icon] : I.lock).join(" ");
  const s = size ?? 24;
  const sw = stroke ?? 2;
  return (
    <svg
      viewBox="0 0 24 24"
      width={s}
      height={s}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: "block", flex: "none", color: color ?? "currentColor", ...style }}
    >
      <path d={d} />
    </svg>
  );
}
