"use client";

import type { DeviceArt as Art } from "@/lib/catalog";
import type { Rule, SensorKind } from "@/lib/types";
import type { Reading } from "@/lib/useWatcher";

/** Pieces shared by the parts of the Mission control prototype. */

export const label = "font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted";

export const TAG: Record<SensorKind, string> = { camera: "CAM", sound: "MIC", location: "GPS", heart: "HR", glucose: "GLU", motion: "MOT" };

/** The kind of device drawn where a sense has nothing connected yet. */
export const EMPTY_ART: Record<SensorKind, Art> = { camera: "glasses", sound: "pendant", location: "phone", heart: "band", glucose: "patch", motion: "watch" };

/** One line of the live check log. */
export type CheckLine = { id: string; at: number; kind: SensorKind; value: string; probability?: number; on?: boolean };

export function Spinner() {
  return <span className="h-3 w-3 animate-[lab-spin_0.7s_linear_infinite] rounded-full border-2 border-line border-t-foreground" aria-hidden />;
}

export function stateOf(rule: Rule, reading: Reading | undefined, connected: boolean): { text: string; className: string } {
  if (!rule.enabled) return { text: "OFF", className: "text-muted" };
  if (!connected) return { text: "NO DEVICE", className: "text-muted" };
  if (!reading) return { text: "STARTING", className: "text-muted" };
  if (reading.on) return { text: "FIRING", className: "font-semibold text-[var(--fire-ink)]" };
  if (reading.probability >= 0.3) return { text: "CLOSE", className: "font-semibold text-foreground" };
  return { text: "WATCHING", className: "text-muted" };
}

export function Toggle({ on, onToggle, name }: { on: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={name}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={`relative h-5 w-9 shrink-0 rounded-[3px] border transition-colors ${on ? "border-foreground bg-foreground" : "border-muted/60 bg-card"}`}
    >
      <span className={`absolute top-[3px] h-3 w-3 rounded-[2px] transition-all ${on ? "left-[19px] bg-background" : "left-[3px] bg-muted/70"}`} />
    </button>
  );
}
