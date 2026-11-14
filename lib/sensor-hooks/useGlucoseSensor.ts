"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GlucoseState } from "../sensors";

/** A monitor reports every five minutes, so asking once a minute never misses a reading. */
const POLL_MS = 60_000;
const HISTORY_MS = 30 * 60_000;
const MG_DL_PER_MMOL_L = 18.016;
/** Glucose below 70 mg/dL is low and above 180 is high: the usual target range. */
const LOW_MG_DL = 70;
const HIGH_MG_DL = 180;
/** Change over fifteen minutes, in mg/dL, that counts as moving, and as moving quickly. */
const MOVING = 15;
const MOVING_QUICKLY = 30;

type Sample = { at: number; mgDl: number };

function trendOf(change: number): GlucoseState["trend"] {
  if (change >= MOVING_QUICKLY) return "rising quickly";
  if (change >= MOVING) return "rising";
  if (change <= -MOVING_QUICKLY) return "falling quickly";
  if (change <= -MOVING) return "falling";
  return "steady";
}

/**
 * Reads blood glucose from a continuous glucose monitor through its Nightscout site, the
 * open-source service many Dexcom and Libre users send their readings to, or from a simulator.
 * A reading holds the level in both common units, which way it is heading, and how fast.
 */
export function useGlucoseSensor() {
  const [source, setSource] = useState<{ kind: "nightscout" | "simulator"; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<GlucoseState | null>(null);

  const stateRef = useRef<GlucoseState | null>(null);
  const samples = useRef<Sample[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  const publish = useCallback(() => {
    const history = samples.current;
    const latest = history.at(-1);
    if (!latest) return;
    // The sample nearest to fifteen minutes before the latest, or the oldest while there is less history.
    const before = history.find((sample) => sample.at >= latest.at - 15 * 60_000) ?? history[0];
    const change = latest.mgDl - before.mgDl;
    const next: GlucoseState = {
      glucose_mg_dl: Math.round(latest.mgDl),
      glucose_mmol_l: Math.round((latest.mgDl / MG_DL_PER_MMOL_L) * 10) / 10,
      range: latest.mgDl < LOW_MG_DL ? "low" : latest.mgDl > HIGH_MG_DL ? "high" : "in range",
      trend: trendOf(change),
      change_last_15_minutes_mg_dl: Math.round(change),
      minutes_since_reading: Math.max(0, Math.floor((Date.now() - latest.at) / 60_000)),
    };
    stateRef.current = next;
    setReading(next);
  }, []);

  const record = useCallback(
    (sample: Sample) => {
      const history = samples.current.filter((item) => item.at !== sample.at);
      history.push(sample);
      history.sort((a, b) => a.at - b.at);
      samples.current = history.filter((item) => item.at >= sample.at - HISTORY_MS);
      publish();
    },
    [publish],
  );

  const disconnect = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    samples.current = [];
    stateRef.current = null;
    setReading(null);
    setSource(null);
  }, []);

  /** Connects to a Nightscout site. `token` is only needed when the site is not open to read. */
  const connectNightscout = useCallback(
    async (url: string, token: string) => {
      disconnect();
      const load = async (): Promise<string | null> => {
        try {
          const response = await fetch("/api/glucose", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url, token }),
          });
          const body = await response.json();
          if (!response.ok) return body.error ?? "The glucose monitor could not be read.";
          for (const sample of body.readings as Sample[]) record(sample);
          return samples.current.length > 0 ? null : "That site has no glucose readings yet.";
        } catch {
          return "The glucose monitor could not be reached.";
        }
      };

      const problem = await load();
      if (problem) {
        setError(problem);
        return;
      }
      let host = url;
      try {
        host = new URL(url).hostname;
      } catch {
        // Shown as typed.
      }
      const poll = setInterval(() => void load().then((failure) => setError(failure)), POLL_MS);
      // Keeps "minutes since the reading" current between readings.
      const tick = setInterval(publish, 30_000);
      stopRef.current = () => {
        clearInterval(poll);
        clearInterval(tick);
      };
      setSource({ kind: "nightscout", label: host });
      setError(null);
    },
    [disconnect, publish, record],
  );

  const connectSimulator = useCallback(() => {
    disconnect();
    record({ at: Date.now(), mgDl: 104 });
    stopRef.current = () => {};
    setSource({ kind: "simulator", label: "Simulator" });
    setError(null);
  }, [disconnect, record]);

  /** Sets the simulated glucose level. The trend follows from how far it moved. */
  const simulate = useCallback((mgDl: number) => record({ at: Date.now(), mgDl }), [record]);

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

  const getState = useCallback(() => stateRef.current, []);

  return {
    connected: source !== null,
    source,
    error,
    reading,
    connectNightscout,
    connectSimulator,
    simulate,
    disconnect,
    getState,
  };
}
