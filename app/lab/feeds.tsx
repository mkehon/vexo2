"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { DeviceArt as Art } from "@/lib/catalog";
import type { Place } from "@/lib/sensor-hooks/useLocationSensor";
import type { LocationState } from "@/lib/sensors";
import type { SensorKind } from "@/lib/types";
import { firstSlot, scopeStudio, type Studio } from "@/lib/useStudio";
import { SensorIcon } from "../ui";
import { DeviceArt } from "./visuals";

/**
 * What a sense is reading right now, drawn to fill whatever box it is put in: the camera's
 * picture, a map for location, and a figure with its last minute for everything else.
 */

const mono = "font-mono text-[11px] font-medium uppercase tracking-[0.06em]";

/** The last minute of a reading, sampled once a second. */
function useTrail(value: number | null): number[] {
  const [trail, setTrail] = useState<number[]>([]);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = latest.current;
      setTrail((previous) => (current === null ? [] : [...previous, current].slice(-60)));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  return trail;
}

/** A reading drawn over the last minute, filling the space it is given. `marks` are levels worth showing, such as a limit. */
function Trace({ values, floor, ceiling, marks = [] }: { values: number[]; floor: number; ceiling: number; marks?: number[] }) {
  const width = 200;
  const height = 80;
  const low = Math.min(floor, ...values);
  const high = Math.max(ceiling, ...values);
  const y = (value: number) => height - 4 - ((value - low) / (high - low || 1)) * (height - 8);
  const x = (index: number) => width - (values.length - 1 - index) * (width / 59);
  const points = values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const last = values.at(-1);
  return (
    <div className="relative min-h-0 flex-1" aria-hidden>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {marks.map((mark) => (
          <line key={mark} x1="0" x2={width} y1={y(mark)} y2={y(mark)} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" vectorEffect="non-scaling-stroke" />
        ))}
        {values.length > 1 && (
          <>
            <polygon points={`${x(0).toFixed(1)},${height} ${points} ${width},${height}`} fill="currentColor" opacity="0.07" />
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {marks.map((mark) => (
        <span key={mark} className="absolute left-0 -translate-y-full font-mono text-[10px] leading-none text-muted" style={{ top: `${(y(mark) / height) * 100}%` }}>
          {mark}
        </span>
      ))}
      {last !== undefined && (
        <span className="absolute right-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-current" style={{ top: `${(y(last) / height) * 100}%` }} />
      )}
    </div>
  );
}

/** The reading itself, large. `dense` is for a narrow box, where the unit is dropped to keep the figure whole. */
function Big({ value, unit, dense }: { value: string; unit: string; dense?: boolean }) {
  return (
    <p className="flex min-w-0 items-baseline gap-2">
      <span className={`truncate font-mono font-medium leading-none tracking-tight tabular-nums ${dense ? "text-[19px]" : "text-[26px]"}`}>{value}</span>
      <span className={`truncate ${mono} text-muted`}>{dense ? unit.split(" ")[0] : unit}</span>
    </p>
  );
}

/**
 * The camera's picture. There is one real <video> on the page, which the detector reads;
 * every picture the person sees is a copy of its stream, so it can appear in several places.
 */
export function MirrorVideo({ source, version, className = "" }: { source: RefObject<HTMLVideoElement | null>; version: string; className?: string }) {
  const copy = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const main = source.current;
    const element = copy.current;
    if (!main || !element) return;
    // A camera or shared screen is already a stream. A file is turned into one.
    const capture = (main as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    element.srcObject = main.srcObject instanceof MediaStream ? main.srcObject : (capture?.call(main) ?? null);
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, [source, version]);
  return <video ref={copy} muted playsInline className={className} />;
}

/** Where a position falls on the world map at a zoom level, in tiles. */
function tileOf(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const scale = 2 ** zoom;
  const radians = (latitude * Math.PI) / 180;
  return {
    x: ((longitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * scale,
  };
}

const ZOOM = 16;
const TILE = 256;

/** A street map centred on the device, with where tracking began and the saved places marked. */
function LocationMap({ reading, origin, places }: { reading: LocationState; origin: { latitude: number; longitude: number } | null; places: Place[] }) {
  const here = tileOf(reading.latitude, reading.longitude, ZOOM);
  const column = Math.floor(here.x);
  const row = Math.floor(here.y);
  // How far a point is from the device, in pixels on the map.
  const offset = (point: { latitude: number; longitude: number }) => {
    const tile = tileOf(point.latitude, point.longitude, ZOOM);
    return { left: `calc(50% + ${((tile.x - here.x) * TILE).toFixed(1)}px)`, top: `calc(50% + ${((tile.y - here.y) * TILE).toFixed(1)}px)` };
  };
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#E9E9E4]">
      <div
        className="absolute h-[768px] w-[768px] grayscale-[0.85] contrast-[0.92]"
        style={{ left: `calc(50% - ${((here.x - column + 1) * TILE).toFixed(1)}px)`, top: `calc(50% - ${((here.y - row + 1) * TILE).toFixed(1)}px)` }}
      >
        {[-1, 0, 1].flatMap((dy) =>
          [-1, 0, 1].map((dx) => (
            // eslint-disable-next-line @next/next/no-img-element -- map tiles are plain images
            <img
              key={`${dx},${dy}`}
              src={`https://tile.openstreetmap.org/${ZOOM}/${column + dx}/${row + dy}.png`}
              alt=""
              width={TILE}
              height={TILE}
              className="absolute"
              style={{ left: (dx + 1) * TILE, top: (dy + 1) * TILE }}
            />
          )),
        )}
      </div>
      {origin && (
        <span className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-foreground bg-card px-1 font-mono text-[10px] font-medium" style={offset(origin)}>
          START
        </span>
      )}
      {places.map((place) => (
        <span key={place.name} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-[2px] bg-foreground px-1 font-mono text-[10px] font-medium text-background" style={offset(place)}>
          {place.name}
        </span>
      ))}
      <span className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full bg-[var(--fire)] opacity-30" aria-hidden />
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--fire)]" aria-hidden />
      <p className="absolute bottom-1 right-1.5 text-[9px] text-black/55">© OpenStreetMap</p>
    </div>
  );
}

/** The few words under a sense's reading: its average, its range, where it is. */
export function feedNote(studio: Studio, kind: SensorKind): string {
  const { sound, location, heart, glucose, motion } = studio.devices;
  if (kind === "camera") return studio.sensors.camera.connected ? "1024 px frames" : "";
  if (kind === "sound" && sound.reading) {
    return sound.reading.heard_in_last_15_seconds ? `Heard “${sound.reading.heard_in_last_15_seconds}”` : "No words in the last 15 s";
  }
  if (kind === "location" && location.reading) {
    return `${location.reading.currently_at.length > 0 ? `At ${location.reading.currently_at.join(", ")}` : "No saved place"} · ${location.reading.speed_kmh} km/h`;
  }
  if (kind === "heart" && heart.reading) {
    return `Avg ${heart.reading.average_bpm_last_minute} · range ${heart.reading.lowest_bpm_last_5_minutes}–${heart.reading.highest_bpm_last_5_minutes}`;
  }
  if (kind === "glucose" && glucose.reading) return `${glucose.reading.trend} · ${glucose.reading.glucose_mmol_l} mmol/L · ${glucose.reading.range}`;
  if (kind === "motion" && motion.reading) {
    return motion.reading.free_fall_in_last_3_seconds && motion.reading.impact_in_last_3_seconds ? "Dropped just now" : motion.reading.orientation;
  }
  return "";
}

function Note({ studio, kind }: { studio: Studio; kind: SensorKind }) {
  return <p className="truncate font-mono text-[11px] text-muted">{feedNote(studio, kind)}</p>;
}

/**
 * What an automation's sense showed when it was switched off, in place of the live feed:
 * the camera's last picture, or the last reading. Fills its parent.
 */
export function PausedFeed({ kind, paused }: { kind: SensorKind; paused?: { thumbnail: string; detail: string } }) {
  return (
    <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 ${paused?.thumbnail ? "bg-[#17181A] text-white" : "text-muted"}`}>
      {paused?.thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element -- a small still kept in the page
        <img src={paused.thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60 grayscale" />
      ) : (
        <SensorIcon sensor={kind} size={22} />
      )}
      <span className={`relative rounded-[3px] px-1.5 py-0.5 ${mono} ${paused?.thumbnail ? "bg-black/60 text-white" : "border border-line"}`}>Paused</span>
      {paused?.detail && <p className="relative max-w-full truncate px-2 font-mono text-[11px]">{paused.detail}</p>}
    </div>
  );
}

/**
 * One sense, live, filling its parent (which must be positioned and sized). With nothing
 * connected it shows the kind of device that could supply it. `slot` picks one of several
 * devices supplying the sense; without it the first connected one is shown. `caption` names
 * the device, for when several are side by side, and `dense` suits a narrow box.
 */
export function SensorFeed(props: { studio: Studio; kind: SensorKind; emptyArt: Art; slot?: number; caption?: string; dense?: boolean }) {
  const { studio: whole, kind, emptyArt, slot, caption, dense } = props;
  const studio = scopeStudio(whole, kind, slot ?? firstSlot(whole, kind));
  const { video, sound, location, heart, glucose, motion } = studio.devices;
  const heartTrail = useTrail(heart.reading?.heart_rate_bpm ?? null);
  const glucoseTrail = useTrail(glucose.reading?.glucose_mg_dl ?? null);
  const motionTrail = useTrail(motion.reading?.peak_acceleration_g_last_second ?? null);
  const soundTrail = useTrail(sound.reading?.loudness_db ?? null);

  if (!studio.sensors[kind].connected) {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1 ${kind === "camera" ? "bg-[#17181A] text-white/55" : "text-muted/70"}`}>
        <DeviceArt art={emptyArt} width={80} />
        <span className={mono}>Add a device</span>
      </div>
    );
  }

  if (kind === "camera") {
    return (
      <div className="absolute inset-0 bg-[#17181A]">
        <MirrorVideo source={studio.videoRef} version={`${video.source?.kind}:${video.source?.label}`} className="h-full w-full object-cover" />
        {["left-2 top-2 border-l border-t", "right-2 top-2 border-r border-t", "left-2 bottom-2 border-l border-b", "right-2 bottom-2 border-r border-b"].map((corner) => (
          <span key={corner} className={`absolute h-3 w-3 border-white/80 ${corner}`} aria-hidden />
        ))}
        <span className={`absolute left-4 top-3 flex items-center gap-1.5 rounded-[3px] bg-black/55 px-1.5 py-0.5 text-white backdrop-blur ${mono}`}>
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
          {video.source?.kind === "file" ? "Replay" : "Live"}
        </span>
        {caption && <span className="absolute bottom-2 left-3 max-w-[85%] truncate rounded-[3px] bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur">{caption}</span>}
      </div>
    );
  }

  if (kind === "location" && location.reading) {
    return (
      <>
        <LocationMap reading={location.reading} origin={location.origin} places={location.places} />
        <p className="absolute left-2 top-2 rounded-[3px] bg-card/90 px-1.5 py-1 font-mono text-[12px] font-medium tabular-nums backdrop-blur">
          {location.reading.distance_from_start_m} m from start · {location.reading.speed_kmh} km/h
        </p>
      </>
    );
  }

  let body = null;
  if (kind === "sound" && sound.reading) {
    body = (
      <>
        <Big value={String(sound.reading.loudness_db)} unit={`dB · ${sound.reading.loudness}`} dense={dense} />
        <div className="flex min-h-0 flex-1 items-end gap-px" aria-hidden>
          {soundTrail.slice(-40).map((db, index) => (
            <span key={index} className="flex-1 bg-current" style={{ height: `${Math.max(4, ((db + 70) / 70) * 100)}%` }} />
          ))}
        </div>
        <p className="line-clamp-2 h-[2.5em] text-[12px] leading-tight" aria-live="polite">
          {sound.reading.heard_in_last_15_seconds ? (
            `“${sound.reading.heard_in_last_15_seconds}”`
          ) : (
            <span className="text-muted">Listening. Words appear here as they are heard.</span>
          )}
        </p>
      </>
    );
  } else if (kind === "heart" && heart.reading) {
    body = (
      <>
        <div className="flex items-center gap-2">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="var(--fire)"
            className="shrink-0"
            style={{ animation: `lab-beat ${(60 / Math.max(30, heart.reading.heart_rate_bpm)).toFixed(2)}s ease-in-out infinite` }}
            aria-hidden
          >
            <path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.2 4.5 6.7 4.5c2 0 3.6 1 5.3 3 1.7-2 3.3-3 5.3-3 3.5 0 5.7 3.5 4.2 7.2C19.5 16.4 12 21 12 21Z" />
          </svg>
          <Big value={String(heart.reading.heart_rate_bpm)} unit="bpm" dense={dense} />
        </div>
        <Trace values={heartTrail} floor={50} ceiling={130} />
        <Note studio={studio} kind={kind} />
      </>
    );
  } else if (kind === "glucose" && glucose.reading) {
    body = (
      <>
        <Big value={String(glucose.reading.glucose_mg_dl)} unit="mg/dL" dense={dense} />
        <Trace values={glucoseTrail} floor={60} ceiling={190} marks={[70, 180]} />
        <Note studio={studio} kind={kind} />
      </>
    );
  } else if (kind === "motion" && motion.reading) {
    body = (
      <>
        <Big value={motion.reading.movement.replace(" movement", "")} unit={`${motion.reading.peak_acceleration_g_last_second.toFixed(1)} g`} dense={dense} />
        <Trace values={motionTrail} floor={0.5} ceiling={2} marks={[1]} />
        <Note studio={studio} kind={kind} />
      </>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col gap-1.5 p-2.5">
      {body}
      {caption && <span className="absolute bottom-1.5 right-1.5 max-w-[70%] truncate rounded-[3px] border border-line bg-card px-1 py-0.5 text-[10px] font-medium text-muted">{caption}</span>}
    </div>
  );
}
