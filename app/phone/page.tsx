"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { setPairing } from "@/lib/relay-client";
import { useLocationSensor } from "@/lib/sensor-hooks/useLocationSensor";
import { useMotionSensor } from "@/lib/sensor-hooks/useMotionSensor";
import { useSoundSensor } from "@/lib/sensor-hooks/useSoundSensor";
import type { SensorKind } from "@/lib/types";
import { useVideoSource } from "@/lib/useVideoSource";
import { Logo, SensorIcon } from "../ui";

/**
 * The page a phone opens to become a sensor for the computer running the app. Each sense is
 * switched on here, on the phone, and what it reads is sent to the computer through the relay
 * (see lib/relay.ts): camera frames as small JPEGs, everything else as readings.
 */

type Kind = "camera" | "sound" | "location" | "motion";
const KINDS: { kind: Kind; name: string; about: string }[] = [
  { kind: "camera", name: "Camera", about: "What the back camera sees" },
  { kind: "sound", name: "Microphone", about: "How loud it is, and the words heard" },
  { kind: "location", name: "Location", about: "Where the phone is and how fast it moves" },
  { kind: "motion", name: "Motion", about: "Shakes, drops and which way up it is" },
];

/** The longest side of a frame sent to the computer. The detector does not need more. */
const FRAME_SIDE = 640;
/** The shortest gap between two frames, which caps it near nine a second. */
const FRAME_GAP_MS = 110;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function PhonePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = useVideoSource(videoRef);
  const sound = useSoundSensor();
  const location = useLocationSensor();
  const motion = useMotionSensor();

  // Which phone this is to the computer, from the link. Read after mount, so server and browser render the same first page.
  const [channel, setChannel] = useState<string | null>(null);
  /** The pairing code from the link, which the computer checks on everything this page sends. */
  const [code, setCode] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setChannel(query.get("as") || "iphone");
    setCode(query.get("k") ?? "");
    setPairing(query.get("k") ?? "");
  }, []);

  /** What the computer is asking for, and whether it is answering at all. */
  const [wanted, setWanted] = useState<string[]>([]);
  const [reachable, setReachable] = useState<boolean | null>(null);
  /** The computer refused the pairing code: the link is an old one, or was typed without it. */
  const [expired, setExpired] = useState(false);

  const send = useCallback(
    async (kind: Kind, body: Blob | string) => {
      if (!channel) return;
      try {
        const response = await fetch(`/api/relay?channel=${channel}&kind=${kind}&k=${code}`, {
          method: "POST",
          headers: { "content-type": typeof body === "string" ? "application/json" : "image/jpeg" },
          body,
        });
        if (response.status === 403) return setExpired(true);
        if (!response.ok) throw new Error(String(response.status));
        setWanted(((await response.json()) as { wanted: string[] }).wanted);
        setReachable(true);
      } catch {
        setReachable(false);
      }
    },
    [channel, code],
  );

  // The camera: one frame after another, each sent once the last has gone.
  const cameraOn = video.source !== null;
  useEffect(() => {
    if (!cameraOn) return;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const run = async () => {
      while (!stopped) {
        const started = performance.now();
        const element = videoRef.current;
        if (element && element.readyState >= 2 && element.videoWidth) {
          const scale = Math.min(1, FRAME_SIDE / Math.max(element.videoWidth, element.videoHeight));
          canvas.width = Math.round(element.videoWidth * scale);
          canvas.height = Math.round(element.videoHeight * scale);
          canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
          const frame = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.6));
          if (frame && !stopped) await send("camera", frame);
        }
        await pause(Math.max(20, FRAME_GAP_MS - (performance.now() - started)));
      }
    };
    void run();
    return () => {
      stopped = true;
    };
  }, [cameraOn, send]);

  // Everything else: the latest reading of each sense that is on, a few times a second.
  const readers = useRef({ sound, location, motion });
  readers.current = { sound, location, motion };
  useEffect(() => {
    if (!channel) return;
    const timer = setInterval(() => {
      const { sound: s, location: l, motion: m } = readers.current;
      for (const [kind, sensor] of [["sound", s], ["location", l], ["motion", m]] as const) {
        const state = sensor.connected ? sensor.getState() : null;
        if (state) void send(kind, JSON.stringify({ state }));
      }
    }, 300);
    return () => clearInterval(timer);
  }, [channel, send]);

  // With nothing switched on yet, ask now and then what the computer is waiting for.
  const anyOn = cameraOn || sound.connected || location.connected || motion.connected;
  useEffect(() => {
    if (!channel || anyOn) return;
    const ask = async () => {
      try {
        const response = await fetch(`/api/relay?channel=${channel}&k=${code}`);
        if (response.status === 403) return setExpired(true);
        setWanted(((await response.json()) as { wanted?: string[] }).wanted ?? []);
        setReachable(response.ok);
      } catch {
        setReachable(false);
      }
    };
    void ask();
    const timer = setInterval(() => void ask(), 1500);
    return () => clearInterval(timer);
  }, [channel, code, anyOn]);

  const senses: Record<Kind, { on: boolean; value: string | null; error: string | null; toggle: () => void }> = {
    camera: {
      on: cameraOn,
      value: cameraOn ? "Sending video" : null,
      error: video.error,
      toggle: () => (cameraOn ? video.disconnect() : void video.connectCamera()),
    },
    sound: {
      on: sound.connected,
      value: sound.reading ? `${sound.reading.loudness_db} dB${sound.reading.heard_in_last_15_seconds ? ` · “${sound.reading.heard_in_last_15_seconds}”` : ""}` : null,
      error: sound.error,
      toggle: () => (sound.connected ? sound.disconnect() : void sound.connect()),
    },
    location: {
      on: location.connected,
      value: location.reading ? `${location.reading.distance_from_start_m} m from start · ${location.reading.speed_kmh} km/h` : location.connected ? "Finding the position…" : null,
      error: location.error,
      toggle: () => (location.connected ? location.disconnect() : location.connectGps()),
    },
    motion: {
      on: motion.connected,
      value: motion.reading ? `${motion.reading.movement} · ${motion.reading.orientation}` : null,
      error: motion.error,
      toggle: () => (motion.connected ? motion.disconnect() : void motion.connectDevice()),
    },
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 bg-background px-4 py-5 text-foreground">
      <header className="flex items-center gap-2.5">
        <Logo />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{BRAND_NAME}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`h-2 w-2 rounded-full ${expired || reachable === false ? "bg-danger" : anyOn ? "animate-pulse bg-hit" : "bg-muted/50"}`} aria-hidden />
            {expired ? "This link has expired" : reachable === false ? "Cannot reach the computer" : anyOn ? "Sending to the computer" : "Ready. Turn on what to share."}
          </p>
        </div>
      </header>

      {expired && (
        <p role="alert" className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">
          The computer no longer accepts this link, usually because the app was restarted. Scan the code it shows again.
        </p>
      )}

      <div className={`overflow-hidden rounded-2xl bg-black ${cameraOn ? "" : "hidden"}`}>
        <video ref={videoRef} muted playsInline className="aspect-video w-full object-cover" />
      </div>

      <ul className="flex flex-col gap-2.5">
        {KINDS.map(({ kind, name, about }) => {
          const sense = senses[kind];
          const asked = !sense.on && wanted.includes(kind);
          return (
            <li key={kind}>
              <button
                type="button"
                role="switch"
                aria-checked={sense.on}
                onClick={sense.toggle}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                  sense.on ? "border-hit bg-hit-soft" : asked ? "border-foreground bg-card" : "border-line bg-card"
                }`}
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${sense.on ? "bg-hit text-white" : "bg-brand-soft"}`}>
                  <SensorIcon sensor={kind as SensorKind} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">{name}</span>
                  <span className={`block truncate text-sm ${sense.error ? "text-danger" : asked ? "font-medium text-foreground" : "text-muted"}`}>
                    {sense.error ?? sense.value ?? (asked ? "The computer is waiting for this. Tap to turn it on." : about)}
                  </span>
                </span>
                <span className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${sense.on ? "bg-hit" : "bg-line"}`} aria-hidden>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${sense.on ? "left-6" : "left-1"}`} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-auto text-center text-xs leading-relaxed text-muted">
        Keep this page open and the screen on. Nothing is sent until you turn a sense on, and only the computer that showed you the code can see it.
      </p>
    </main>
  );
}
