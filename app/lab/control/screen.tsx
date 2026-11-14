"use client";

import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { conditionsOf, SENSOR_ORDER } from "@/lib/sensors";
import type { SensorKind } from "@/lib/types";
import { useComposer } from "@/lib/useComposer";
import { firstSlot, scopeStudio, useStudio } from "@/lib/useStudio";
import { SettingsDialog } from "../../settings-dialog";
import { Logo } from "../../ui";
import { DeviceGallery } from "../device-gallery";
import { SensorSheet, useNow } from "../parts";
import { AutomationBuilder } from "./builder";
import { RuleLanes } from "./layouts";
import { CheckStream, EventLog } from "./logs";
import { label, type CheckLine } from "./shared";

/**
 * The app's one screen, "Mission control": dense and technical. Each automation is a lane
 * beside the live sense it watches, and everything that happens is logged as it happens.
 */

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

const THEME = {
  "--background": "#F2F2EE",
  "--foreground": "#151515",
  "--card": "#FFFFFF",
  "--line": "#D8D8D2",
  "--muted": "#5C5C57",
  "--brand": "#151515",
  "--brand-soft": "#ECECE6",
  "--on-brand": "#FFFFFF",
  "--accent": "#151515",
  "--hit": "#1B7F3B",
  "--hit-soft": "#E4F3E8",
  "--danger": "#B42318",
  "--danger-soft": "#FDECEA",
  "--fire": "#E8490F",
  "--fire-ink": "#B93A0A",
  "--fire-soft": "#FFF3EA",
  // Shared panels and dialogs pick up the squarer corners and the typefaces of this screen.
  "--radius-md": "3px",
  "--radius-lg": "4px",
  "--radius-xl": "6px",
  "--radius-2xl": "8px",
  "--radius-3xl": "10px",
  "--font-geist-sans": "var(--font-plex-sans)",
  "--font-geist-mono": "var(--font-plex-mono)",
  fontFamily: "var(--font-plex-sans), system-ui, sans-serif",
} as CSSProperties;

const KEYFRAMES = `
@keyframes lab-check {
  0% { transform: scale(1); opacity: 1 }
  100% { transform: scale(2.6); opacity: 0 }
}
@keyframes lab-fired {
  0% { box-shadow: 0 0 0 0 rgb(232 73 15 / 0.45) }
  100% { box-shadow: 0 0 0 14px rgb(232 73 15 / 0) }
}
@keyframes lab-enter {
  0% { opacity: 0; transform: translateY(-6px) }
  100% { opacity: 1; transform: translateY(0) }
}
@keyframes lab-beat {
  0%, 100% { transform: scale(1) }
  15% { transform: scale(1.3) }
  30% { transform: scale(1) }
}
@keyframes lab-spin {
  100% { transform: rotate(360deg) }
}
`;

export default function MissionControl() {
  const studio = useStudio();
  const composer = useComposer(studio);
  const now = useNow(500);
  /** The sense, and which of its devices, whose controls are open. */
  const [sheet, setSheet] = useState<{ kind: SensorKind; slot: number } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Every check, as it happens: which sense, what it read, and how sure the detector was.
  const [stream, setStream] = useState<CheckLine[]>([]);
  const counted = useRef(studio.checks);
  const lastLine = useRef<Partial<Record<SensorKind, { at: number; on?: boolean }>>>({});
  useEffect(() => {
    const lines: CheckLine[] = [];
    for (const kind of SENSOR_ORDER) {
      if (studio.checks[kind] === counted.current[kind]) continue;
      // The surest answer among this sense's conditions, on any of its devices.
      const top = studio.rules
        .filter((rule) => rule.enabled)
        .flatMap((rule) =>
          conditionsOf(rule).flatMap((condition, index) => {
            const reading = condition.sensor === kind ? studio.readings[`${rule.id}#${index}`] : undefined;
            return reading ? [reading] : [];
          }),
        )
        .sort((a, b) => b.probability - a.probability)[0];
      // A fast sensor would flood the log, so its lines are thinned unless the answer changed.
      const previous = lastLine.current[kind];
      if (previous && Date.now() - previous.at < 700 && previous.on === top?.on) continue;
      lastLine.current[kind] = { at: Date.now(), on: top?.on };
      lines.push({
        id: `${kind}-${studio.checks[kind]}`,
        at: Date.now(),
        kind,
        value: studio.sensors[kind].value ?? "",
        probability: top?.probability,
        on: top?.on,
      });
    }
    counted.current = studio.checks;
    if (lines.length > 0) setStream((previous) => [...lines, ...previous].slice(0, 40));
    // Only a new check should add lines; the rules and readings are read as they are at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studio.checks]);

  const liveCount = SENSOR_ORDER.filter((kind) => studio.sensors[kind].connected).length;
  const armed = studio.rules.filter((rule) => rule.enabled).length;
  const firing = studio.rules.filter((rule) => rule.enabled && studio.readings[rule.id]?.on).length;
  const openSense = (kind: SensorKind, slot?: number) =>
    studio.sensors[kind].connected ? setSheet({ kind, slot: slot ?? firstSlot(studio, kind) }) : setGalleryOpen(true);
  const openControls = (kind: SensorKind, slot: number) => setSheet({ kind, slot });
  const shared = { studio, now, onOpenSense: openSense };

  return (
    <div style={THEME} className={`${sans.variable} ${mono.variable} min-h-screen bg-background text-[13px] text-foreground`}>
      <style>{KEYFRAMES}</style>
      {/* The real videos, one per camera, which the detector reads. Kept out of sight: every picture shown is a copy of a stream. */}
      {studio.videoRefs.map((ref, slot) => (
        <video key={slot} ref={ref} muted playsInline aria-hidden className="pointer-events-none fixed bottom-0 right-0 h-px w-px opacity-0" />
      ))}

      <header className="sticky top-0 z-20 flex h-11 items-center justify-between gap-6 border-b border-line bg-card px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Logo />
          <span className="truncate text-[13px] font-semibold">{BRAND_NAME}</span>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <dl className={`flex items-center gap-4 ${label}`}>
            {(
              [
                ["Detector", studio.detectorMs !== undefined ? `${studio.detectorMs} ms` : "ready"],
                ["Checks", `${studio.checksPerSecond.toFixed(1)}/s`],
                ["Senses", `${liveCount}/${SENSOR_ORDER.length}`],
                ["Armed", String(armed)],
              ] as const
            ).map(([name, value]) => (
              <div key={name} className="flex items-baseline gap-1.5">
                <dt>{name}</dt>
                <dd className="tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
            {firing > 0 && (
              <div className="flex items-center gap-1.5 text-[var(--fire-ink)]">
                <span className="h-2 w-2 animate-pulse bg-[var(--fire)]" aria-hidden />
                {firing} firing
              </div>
            )}
          </dl>
          {studio.needsDetectorKey && (
            <button type="button" onClick={() => setSettingsOpen(true)} className="h-7 rounded-md bg-danger-soft px-2.5 text-xs font-semibold text-danger">
              Add your TypeSafe key
            </button>
          )}
          <button
            type="button"
            onClick={() => setGalleryOpen(true)}
            className="h-7 rounded-md border border-line bg-card px-2.5 text-xs font-medium transition-colors hover:bg-background"
          >
            Devices
          </button>
          <button
            type="button"
            onClick={() => setBuilderOpen(true)}
            className="flex h-7 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-xs font-semibold text-background transition-opacity hover:opacity-90"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add automation
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="h-7 rounded-md border border-line bg-card px-2.5 text-xs font-medium transition-colors hover:bg-background"
          >
            Settings
          </button>
        </div>
      </header>

      <main className="grid grid-cols-[minmax(0,1fr)_21rem] items-start gap-3 p-3">
        <div className="flex min-w-0 flex-col gap-2">
          {studio.detectorError && !studio.needsDetectorKey && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
              The detector stopped: {studio.detectorError}
            </p>
          )}
          <RuleLanes {...shared} onAdd={() => setBuilderOpen(true)} />
        </div>

        <div className="sticky top-14 flex flex-col gap-3">
          <EventLog studio={studio} now={now} />
          <CheckStream lines={stream} />
        </div>
      </main>

      <AutomationBuilder
        open={builderOpen}
        studio={studio}
        composer={composer}
        now={now}
        onOpenControls={openControls}
        onOpenSettings={() => setSettingsOpen(true)}
        onClose={() => setBuilderOpen(false)}
      />
      <DeviceGallery studio={studio} open={galleryOpen} onOpenControls={openControls} onClose={() => setGalleryOpen(false)} />
      <SensorSheet studio={sheet ? scopeStudio(studio, sheet.kind, sheet.slot) : studio} sensor={sheet?.kind ?? null} onClose={() => setSheet(null)} />
      <SettingsDialog open={settingsOpen} settings={studio.settings} onClose={() => setSettingsOpen(false)} onChange={studio.setSettings} />
    </div>
  );
}
