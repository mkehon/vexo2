"use client";

import { useEffect, useRef, useState } from "react";
import { sensorOf, type SensorState } from "./sensors";
import { newTrigger, step, type Trigger } from "./trigger";
import type { Rule, SensorKind, WatchQuestion } from "./types";
import type { Reading, WatchStats } from "./useWatcher";

/** How often to look for a new reading. */
const POLL_MS = 250;
/** Shortest gap between two checks when the reading keeps changing. */
const CHANGED_INTERVAL_MS = 500;
/** How often to check while the reading stays the same. */
const IDLE_INTERVAL_MS = 3000;
/** Gap before the confirming check, once a rule has had its first yes or no. */
const CONFIRM_INTERVAL_MS = 150;
/** Wait after a failed check, so a missing key or outage doesn't spam requests. */
const ERROR_BACKOFF_MS = 2000;

/**
 * The counterpart of `useWatcher` for sensors that send readings instead of frames.
 * While `active`, sends the sensor's latest reading to the detector with the question of
 * every enabled rule for that sensor, and calls `onFire` when a rule's condition changes
 * from no to yes.
 */
export function useStateWatcher<State extends SensorState>(options: {
  sensor: SensorKind;
  rules: Rule[];
  active: boolean;
  /** The latest reading, or null while the sensor has none yet. */
  getState: () => State | null;
  onFire: (rule: Rule, probability: number, state: State) => void;
}) {
  const { sensor, rules, active, getState, onFire } = options;
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The loop reads these through refs so editing rules doesn't restart it.
  const rulesRef = useRef(rules);
  const getStateRef = useRef(getState);
  const onFireRef = useRef(onFire);
  useEffect(() => {
    rulesRef.current = rules;
    getStateRef.current = getState;
    onFireRef.current = onFire;
  }, [rules, getState, onFire]);

  useEffect(() => {
    if (!active) {
      setReadings({});
      setStats(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const triggers = new Map<string, Trigger>();
    let checking = false;
    let lastStarted = -Infinity;
    let retryAfter = 0;
    /** The reading and rule set last sent, to tell whether anything has changed since. */
    let lastSent = "";
    /** A rule is one reading away from changing state, so the next check should not wait. */
    let confirming = false;
    let recentStarts: number[] = [];

    const check = async (state: State, enabled: Rule[]): Promise<boolean> => {
      const questions: WatchQuestion[] = enabled.map(({ id, question, yes, no }) => ({ id, question, yes, no }));
      const response = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sensor, state, questions }),
      });
      const body = await response.json();
      if (cancelled) return false;
      if (!response.ok) throw new Error(body.error ?? `The detector returned ${response.status}.`);

      const now = Date.now();
      const next: Record<string, Reading> = {};
      let anyPending = false;
      for (const rule of enabled) {
        const probability = body.answers?.[rule.id];
        if (typeof probability !== "number") continue;
        const { next: trigger, fired, pending } = step(triggers.get(rule.id) ?? newTrigger(), probability, now);
        triggers.set(rule.id, trigger);
        next[rule.id] = { probability, on: trigger.on };
        anyPending ||= pending;
        if (fired) onFireRef.current(rule, probability, state);
      }
      setReadings(next);
      setStats({ detectorMs: body.ms, model: body.model, checksPerSecond: recentStarts.length / 2 });
      setError(null);
      return anyPending;
    };

    const poll = async (): Promise<void> => {
      if (cancelled || checking) return;
      const now = performance.now();
      if (now < retryAfter) return;

      const enabled = rulesRef.current.filter((rule) => rule.enabled && sensorOf(rule) === sensor);
      // A rule that is removed or switched off starts fresh if it comes back.
      for (const id of triggers.keys()) {
        if (!enabled.some((rule) => rule.id === id)) triggers.delete(id);
      }
      const state = getStateRef.current();
      if (enabled.length === 0 || !state) {
        setReadings((previous) => (Object.keys(previous).length ? {} : previous));
        lastSent = "";
        return;
      }

      const sending = JSON.stringify([state, enabled.map((rule) => rule.id)]);
      const wait = confirming ? CONFIRM_INTERVAL_MS : sending !== lastSent ? CHANGED_INTERVAL_MS : IDLE_INTERVAL_MS;
      if (now - lastStarted < wait) return;

      checking = true;
      lastStarted = now;
      lastSent = sending;
      recentStarts = [...recentStarts.filter((started) => now - started < 2000), now];
      try {
        confirming = await check(state, enabled);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        confirming = false;
        retryAfter = performance.now() + ERROR_BACKOFF_MS;
      } finally {
        checking = false;
      }
    };

    const timer = setInterval(() => void poll(), POLL_MS);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, sensor]);

  return { readings, stats, error };
}
