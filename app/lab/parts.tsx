"use client";

import { useEffect, useRef, useState } from "react";
import { appOf } from "@/lib/catalog";
import { NO_THRESHOLD, YES_THRESHOLD } from "@/lib/trigger";
import type { Output, SensorKind } from "@/lib/types";
import { SENSORS } from "@/lib/sensors";
import type { Sample, Studio } from "@/lib/useStudio";
import { GlucosePanel, HeartPanel, LocationPanel, MotionPanel, SoundPanel } from "../sensor-panels";
import { CameraIcon, ConnectorTile, FilmIcon, ScreenIcon, secondaryButton } from "../ui";

/** Shared pieces for the prototype screens under /lab. Each screen supplies its own look. */

/** The current time, refreshed on an interval, for charts and "3 s ago" labels that keep moving. */
export function useNow(intervalMs: number): number {
  // Starts at zero and is set after mount, because the page is first rendered ahead of time, where the clock is meaningless.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 2) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function describeAction(output: Output): string {
  if (output.kind === "speak") return `say “${output.message}”`;
  if (output.kind === "call" || output.kind === "text") return `${output.kind} ${output.to}`;
  const app = appOf(output);
  if (app) return `${["slack", "discord", "teams"].includes(app.id) ? "post to" : "send to"} ${app.name}`;
  let host = output.url;
  try {
    host = new URL(output.url).hostname;
  } catch {
    // Shown as typed.
  }
  return `send a webhook to ${host}`;
}

/**
 * How sure the detector has been over the last minute, as a line. The dashed line is the
 * level a reading has to reach to count as yes, and a tick marks each time the automation fired.
 * Colours come from the text colour and `--line`, so each screen can style it.
 */
export function Sparkline(props: {
  samples: Sample[] | undefined;
  now: number;
  width?: number;
  height?: number;
  spanMs?: number;
  className?: string;
}) {
  const { samples = [], now, width = 240, height = 36, spanMs = 60_000, className = "" } = props;
  const pad = 2;
  const x = (at: number) => ((at - (now - spanMs)) / spanMs) * width;
  const y = (probability: number) => height - pad - probability * (height - pad * 2);
  const visible = samples.filter((sample) => sample.at >= now - spanMs);
  const points = visible.map((sample) => `${x(sample.at).toFixed(1)},${y(sample.probability).toFixed(1)}`);
  const last = visible.at(-1);
  // Carry the latest value to the right edge, so the line reaches "now" between checks.
  if (last) points.push(`${width},${y(last.probability).toFixed(1)}`);
  const fires = visible.filter((sample, index) => sample.on && !(visible[index - 1]?.on ?? false) && index > 0);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`block ${className}`}
      style={{ width: "100%", height }}
      role="img"
      aria-label="How sure the detector has been over the last minute"
    >
      <line x1="0" x2={width} y1={y(YES_THRESHOLD)} y2={y(YES_THRESHOLD)} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      <line x1="0" x2={width} y1={y(NO_THRESHOLD)} y2={y(NO_THRESHOLD)} stroke="var(--line)" strokeWidth="1" strokeDasharray="1 4" vectorEffect="non-scaling-stroke" />
      {points.length > 1 && (
        <>
          <polygon points={`${x(visible[0].at).toFixed(1)},${height} ${points.join(" ")} ${width},${height}`} fill="currentColor" opacity="0.1" />
          <polyline points={points.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </>
      )}
      {fires.map((sample) => (
        <line key={sample.at} x1={x(sample.at)} x2={x(sample.at)} y1="0" y2={height} stroke="var(--fire, currentColor)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** How sure the detector is right now, as a bar with the yes and no levels marked. */
export function Meter({ probability, on, className = "" }: { probability: number | undefined; on: boolean; className?: string }) {
  const percent = probability === undefined ? 0 : Math.round(probability * 100);
  return (
    <div
      className={`relative h-1.5 rounded-full bg-line ${className}`}
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="How sure the detector is"
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${percent}%`, background: on ? "var(--hit)" : "var(--foreground)" }}
      />
      {[NO_THRESHOLD, YES_THRESHOLD].map((level) => (
        <span key={level} className="absolute -top-1 h-3.5 w-px bg-muted/70" style={{ left: `${level * 100}%` }} aria-hidden />
      ))}
    </div>
  );
}

/** A dialog for connecting one sensor: its sources, its simulator and its live reading. */
export function SensorSheet({ studio, sensor, onClose }: { studio: Studio; sensor: SensorKind | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const { video, sound, location, heart, glucose, motion } = studio.devices;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (sensor && !element.open) element.showModal();
    if (!sensor && element.open) element.close();
  }, [sensor]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the dimmed area around the panel lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="sensor-sheet-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      {sensor && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 id="sensor-sheet-title" className="text-lg font-semibold">
              {SENSORS[sensor].label}
            </h2>
            <button type="button" className={secondaryButton} onClick={onClose}>
              Done
            </button>
          </div>

          {sensor === "camera" && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <ConnectorTile
                  icon={<CameraIcon />}
                  title="Camera"
                  detail="Phone, webcam or USB camera"
                  active={video.source?.kind === "camera"}
                  onClick={() => void video.connectCamera()}
                />
                {video.canShareScreen && (
                  <ConnectorTile
                    icon={<ScreenIcon />}
                    title="Screen or tab"
                    detail="A companion app or live stream"
                    active={video.source?.kind === "screen"}
                    onClick={() => void video.connectScreen()}
                  />
                )}
                <ConnectorTile
                  icon={<FilmIcon />}
                  title="Video file"
                  detail="Recorded footage, on loop"
                  active={video.source?.kind === "file"}
                  onClick={() => fileInput.current?.click()}
                />
                <input
                  ref={fileInput}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void video.connectFile(file);
                    event.target.value = "";
                  }}
                />
              </div>
              {video.source?.kind === "camera" && video.cameras.length > 1 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  Camera
                  <select
                    className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-foreground"
                    value={video.source.deviceId ?? ""}
                    onChange={(event) => void video.connectCamera(event.target.value)}
                  >
                    {video.cameras.map((camera) => (
                      <option key={camera.deviceId} value={camera.deviceId}>
                        {camera.label || "Camera"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {video.source ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm text-muted">
                    Connected: <span className="font-medium text-foreground">{video.source.label}</span>
                  </p>
                  <button type="button" className={`${secondaryButton} shrink-0`} onClick={video.disconnect}>
                    Disconnect
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted">The picture shows on the page once a source is connected.</p>
              )}
              {video.error && (
                <p role="alert" className="text-sm text-danger">
                  {video.error}
                </p>
              )}
            </>
          )}
          {sensor === "sound" && <SoundPanel sound={sound} />}
          {sensor === "location" && <LocationPanel location={location} />}
          {sensor === "heart" && <HeartPanel heart={heart} />}
          {sensor === "glucose" && <GlucosePanel glucose={glucose} />}
          {sensor === "motion" && <MotionPanel motion={motion} />}
        </div>
      )}
    </dialog>
  );
}
