"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { followRemote } from "../relay-client";
import type { MotionState } from "../sensors";

const GRAVITY = 9.80665;
/** How often the reading is refreshed. */
const PUBLISH_MS = 250;
/** Acceleration well below 1 g means the device is falling freely. */
const FREE_FALL_G = 0.35;
/** Acceleration this far above 1 g is a knock or a landing. */
const IMPACT_G = 2.8;
/** How much the acceleration varies over a second, in g, at the edges between movement labels. */
const GENTLE_SPREAD = 0.03;
const ACTIVE_SPREAD = 0.12;
const SHAKING_SPREAD = 0.5;
/** Shaking swings back and forth; a single knock or drop does not. This many swings in a second counts. */
const SHAKING_SWINGS = 6;
/** A swing has to pass this far above and below 1 g to count, so sensor noise is ignored. */
const SWING_MARGIN_G = 0.3;

export type MotionPreset = "still" | "walking" | "shaking" | "dropped" | "face down" | "face up";

type Sample = { at: number; g: number };

function orientationOf(beta: number | null, gamma: number | null): MotionState["orientation"] {
  if (beta === null || gamma === null) return "unknown";
  if (Math.abs(gamma) > 60 && Math.abs(beta) < 60) return "on its side";
  if (Math.abs(beta) < 25) return "flat, screen up";
  if (Math.abs(beta) > 155) return "flat, screen down";
  if (beta > 60 && beta < 120) return "upright";
  if (beta < -60 && beta > -120) return "upside down";
  return "tilted";
}

/**
 * Follows how the device is moving, from its own motion sensors or a simulator. A reading
 * holds a label for the movement, the device's orientation, and whether it was just dropped.
 */
export function useMotionSensor() {
  /** "remote" is another device's motion sensors, arriving through the relay. */
  const [source, setSource] = useState<"device" | "simulator" | "remote" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<MotionState | null>(null);

  const stateRef = useRef<MotionState | null>(null);
  const samples = useRef<Sample[]>([]);
  const tilt = useRef<{ beta: number | null; gamma: number | null }>({ beta: null, gamma: null });
  const lastMoved = useRef(0);
  const stopRef = useRef<(() => void) | null>(null);

  const publish = useCallback(() => {
    const now = Date.now();
    const history = samples.current;
    while (history.length > 0 && history[0].at < now - 3000) history.shift();
    const lastSecond = history.filter((sample) => sample.at >= now - 1000);
    if (lastSecond.length === 0) return;

    const values = lastSecond.map((sample) => sample.g);
    const mean = values.reduce((total, g) => total + g, 0) / values.length;
    const spread = Math.sqrt(values.reduce((total, g) => total + (g - mean) ** 2, 0) / values.length);
    // Count how often the acceleration swings from clearly above 1 g to clearly below, or back.
    let swings = 0;
    let side = 0;
    for (const g of values) {
      const now = g > 1 + SWING_MARGIN_G ? 1 : g < 1 - SWING_MARGIN_G ? -1 : 0;
      if (now !== 0 && now !== side) {
        if (side !== 0) swings += 1;
        side = now;
      }
    }

    let movement: MotionState["movement"] = "still";
    if (spread >= SHAKING_SPREAD && swings >= SHAKING_SWINGS) movement = "shaking";
    else if (spread >= ACTIVE_SPREAD) movement = "active movement";
    else if (spread >= GENTLE_SPREAD) movement = "gentle movement";
    if (movement !== "still") lastMoved.current = now;

    const next: MotionState = {
      movement,
      peak_acceleration_g_last_second: Math.round(Math.max(...values) * 10) / 10,
      orientation: orientationOf(tilt.current.beta, tilt.current.gamma),
      free_fall_in_last_3_seconds: history.some((sample) => sample.g < FREE_FALL_G),
      impact_in_last_3_seconds: history.some((sample) => sample.g > IMPACT_G),
      // Counted in steps of five seconds, so a resting device does not look like a new reading every second.
      seconds_still: Math.floor((now - lastMoved.current) / 5000) * 5,
    };
    stateRef.current = next;
    setReading(next);
  }, []);

  const disconnect = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    samples.current = [];
    tilt.current = { beta: null, gamma: null };
    stateRef.current = null;
    setReading(null);
    setSource(null);
  }, []);

  const begin = useCallback(
    (kind: "device" | "simulator", stop: () => void) => {
      lastMoved.current = Date.now();
      const tick = setInterval(publish, PUBLISH_MS);
      stopRef.current = () => {
        clearInterval(tick);
        stop();
      };
      setSource(kind);
      setError(null);
    },
    [publish],
  );

  const connectDevice = useCallback(async () => {
    if (typeof DeviceMotionEvent === "undefined") {
      setError("This browser cannot read motion sensors.");
      return;
    }
    disconnect();
    // iPhones ask the person before a page may read motion, and only from a tap.
    const ask = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof ask === "function") {
      try {
        if ((await ask()) !== "granted") {
          setError("Motion access was blocked. Allow it in the browser and try again.");
          return;
        }
      } catch {
        setError("Motion access could not be requested. Tap the button again.");
        return;
      }
    }

    let received = false;
    const onMotion = (event: DeviceMotionEvent) => {
      const a = event.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      received = true;
      samples.current.push({ at: Date.now(), g: Math.hypot(a.x, a.y, a.z) / GRAVITY });
    };
    const onTilt = (event: DeviceOrientationEvent) => {
      tilt.current = { beta: event.beta, gamma: event.gamma };
    };
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onTilt);
    // Laptops accept the listeners but never send anything.
    const check = setTimeout(() => {
      if (!received) {
        setError("This device has no motion sensors. Open the app on a phone, or use the simulator.");
        disconnect();
      }
    }, 2000);
    begin("device", () => {
      clearTimeout(check);
      window.removeEventListener("devicemotion", onMotion);
      window.removeEventListener("deviceorientation", onTilt);
    });
  }, [begin, disconnect]);

  const preset = useRef<{ kind: MotionPreset; since: number }>({ kind: "still", since: 0 });

  const connectSimulator = useCallback(() => {
    disconnect();
    preset.current = { kind: "still", since: Date.now() };
    tilt.current = { beta: 0, gamma: 0 };
    // Feeds made-up accelerometer samples through the same analysis as real ones.
    const feed = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - preset.current.since) / 1000;
      let g = 1;
      switch (preset.current.kind) {
        case "walking":
          g = 1 + 0.25 * Math.sin(elapsed * 2 * Math.PI * 2);
          break;
        case "shaking":
          // Four back-and-forth strokes a second, swinging between about 0.2 g and 1.8 g.
          g = 1 + 0.8 * Math.sin(elapsed * 2 * Math.PI * 4);
          break;
        case "dropped":
          // A third of a second falling, a hard landing, then at rest.
          g = elapsed < 0.35 ? 0.05 : elapsed < 0.45 ? 4.5 : 1;
          break;
      }
      samples.current.push({ at: now, g: Math.abs(g) });
    }, 20);
    begin("simulator", () => clearInterval(feed));
  }, [begin, disconnect]);

  /** Makes the simulated device move in the given way. */
  const simulate = useCallback((kind: MotionPreset) => {
    if (kind === "face down") tilt.current = { beta: 180, gamma: 0 };
    else if (kind === "face up") tilt.current = { beta: 0, gamma: 0 };
    preset.current = { kind: kind === "face down" || kind === "face up" ? "still" : kind, since: Date.now() };
  }, []);

  // Stops the source when the page goes away. A code reload during development can run this too
  // while keeping the state, so the source is also forgotten: better shown as off than as on and silent.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
      setSource(null);
    },
    [],
  );

  /** Follows how another device is moving, such as a phone, from the readings it sends through the relay. */
  const connectRemote = useCallback(
    (channel: string) => {
      disconnect();
      stopRef.current = followRemote<MotionState>(channel, "motion", (state) => {
        stateRef.current = state;
        setReading(state);
      });
      setSource("remote");
      setError(null);
    },
    [disconnect],
  );

  const getState = useCallback(() => stateRef.current, []);

  return { connected: source !== null, source, error, reading, connectDevice, connectRemote, connectSimulator, simulate, disconnect, getState };
}
