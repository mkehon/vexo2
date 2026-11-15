"use client";

import { appOf, type DeviceArt as Art } from "@/lib/catalog";
import type { Output } from "@/lib/types";
import { BellIcon, MessageIcon, PhoneIcon, SendIcon, SpeakerIcon } from "../ui";

/** Pictures for the prototype screens: brand icons, device drawings and action icons. */

/** A product's or app's own icon on a white tile, so dark marks stay visible on any background. */
export function BrandIcon({ icon, size = 28, className = "" }: { icon: string; size?: number; className?: string }) {
  // Vector logos need breathing room; site icons are usually drawn edge to edge already.
  const inner = icon.endsWith(".svg") ? size * 0.6 : size * 0.74;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-white ring-1 ring-black/10 ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- small local files, nothing to optimize */}
      <img src={`/brands/${icon}`} alt="" style={{ width: inner, height: inner, objectFit: "contain", borderRadius: inner * 0.18 }} />
    </span>
  );
}

/** The icon for one thing an automation does: the app it sends to, a phone, a speaker, a bell. */
export function ActionIcon({ output, size = 28 }: { output: Output; size?: number }) {
  const app = appOf(output);
  if (app) return <BrandIcon icon={app.icon} size={size} />;
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-foreground text-background"
      style={{ width: size, height: size, borderRadius: size * 0.26 }}
    >
      {output.kind === "speak" ? (
        <SpeakerIcon size={size * 0.6} />
      ) : output.kind === "alarm" ? (
        <BellIcon size={size * 0.6} />
      ) : output.kind === "call" ? (
        <PhoneIcon size={size * 0.6} />
      ) : output.kind === "text" ? (
        <MessageIcon size={size * 0.6} />
      ) : (
        <SendIcon size={size * 0.6} />
      )}
    </span>
  );
}

/**
 * A line drawing of a kind of device. Drawn in the text colour; parts that sit in front of
 * others are filled with `--art-ground` (the colour behind the drawing) to hide what is behind them.
 */
export function DeviceArt({ art, width = 120, className = "" }: { art: Art; width?: number; className?: string }) {
  const ground = "var(--art-ground, var(--background))";
  const solid = { fill: "currentColor", stroke: "none" };
  return (
    <svg
      width={width}
      height={(width * 84) / 120}
      viewBox="0 0 120 84"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {art === "glasses" && (
        <>
          <path d="M14 34 4 28M106 34l10-6" />
          <rect x="14" y="27" width="40" height="31" rx="11" fill="currentColor" fillOpacity="0.06" />
          <rect x="66" y="27" width="40" height="31" rx="11" fill="currentColor" fillOpacity="0.06" />
          <path d="M54 38q6-6 12 0" />
          <circle cx="21.5" cy="34" r="2.3" {...solid} />
          <path d="m25 50 8-12M77 50l8-12" opacity="0.35" />
        </>
      )}
      {art === "phone" && (
        <>
          <rect x="42" y="7" width="36" height="70" rx="9" fill="currentColor" fillOpacity="0.06" />
          <rect x="54" y="12.5" width="12" height="3.6" rx="1.8" {...solid} />
          <path d="M53 71h14" />
        </>
      )}
      {art === "laptop" && (
        <>
          <rect x="28" y="14" width="64" height="44" rx="5" fill="currentColor" fillOpacity="0.06" />
          <path d="M17 62h86l-5 9H22Z" fill={ground} />
          <circle cx="60" cy="19.5" r="1.3" {...solid} />
        </>
      )}
      {art === "watch" && (
        <>
          <path d="m49 21 2-13h18l2 13M49 63l2 13h18l2-13" />
          <rect x="44" y="21" width="32" height="42" rx="10" fill="currentColor" fillOpacity="0.06" />
          <path d="M76 35h3v9h-3" />
          <path d="M51 44h5l3-7 4 13 3-6h4" />
        </>
      )}
      {art === "band" && (
        <>
          <ellipse cx="60" cy="40" rx="39" ry="23" />
          <ellipse cx="60" cy="37" rx="31" ry="15" />
          <rect x="43" y="53" width="34" height="13" rx="6.5" fill={ground} />
          <circle cx="60" cy="59.5" r="1.9" {...solid} />
        </>
      )}
      {art === "ring" && (
        <>
          <circle cx="60" cy="42" r="25" fill="currentColor" fillOpacity="0.06" />
          <circle cx="60" cy="42" r="17" fill={ground} />
          <path d="M42 31a22 22 0 0 1 13-11" opacity="0.4" />
        </>
      )}
      {art === "pendant" && (
        <>
          <path d="M30 6c8 18 20 27 30 30 10-3 22-12 30-30" />
          <circle cx="60" cy="54" r="18" fill={ground} />
          <circle cx="60" cy="54" r="18" fill="currentColor" fillOpacity="0.06" />
          <circle cx="60" cy="54" r="5" />
        </>
      )}
      {art === "strap" && (
        <>
          <path d="M5 40q55-20 110 0M5 53q55-20 110 0" />
          <rect x="43" y="25" width="34" height="24" rx="10" fill={ground} />
          <path d="M51 37h5l3-6 4 11 3-5h4" />
        </>
      )}
      {art === "patch" && (
        <>
          <circle cx="60" cy="42" r="30" strokeDasharray="2.5 5" opacity="0.55" />
          <circle cx="60" cy="42" r="19" fill="currentColor" fillOpacity="0.06" />
          <circle cx="60" cy="42" r="5.5" />
        </>
      )}
      {art === "window" && (
        <>
          <rect x="22" y="13" width="76" height="58" rx="7" fill="currentColor" fillOpacity="0.06" />
          <path d="M22 27h76" />
          <circle cx="31" cy="20" r="1.7" {...solid} />
          <circle cx="38" cy="20" r="1.7" {...solid} />
          <path d="M54 39v20l16-10Z" />
        </>
      )}
      {art === "film" && (
        <>
          <rect x="26" y="15" width="68" height="54" rx="6" fill="currentColor" fillOpacity="0.06" />
          <path d="M40 15v54M80 15v54M26 29h14M26 42h14M26 55h14M80 29h14M80 42h14M80 55h14" />
          <path d="M54 34v16l13-8Z" />
        </>
      )}
      {art === "sliders" && (
        <>
          <path d="M26 25h68M26 42h68M26 59h68" />
          <circle cx="74" cy="25" r="6.5" fill={ground} />
          <circle cx="46" cy="42" r="6.5" fill={ground} />
          <circle cx="64" cy="59" r="6.5" fill={ground} />
        </>
      )}
    </svg>
  );
}
