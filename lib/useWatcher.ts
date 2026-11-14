"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { newTrigger, step, type Trigger } from "./trigger";
import type { Rule, WatchQuestion } from "./types";

/** Shortest gap between the start of two checks: about two checks a second. */
const MIN_INTERVAL_MS = 500;
/** Wait after a failed check, so a missing key or outage doesn't spam requests. */
const ERROR_BACKOFF_MS = 2000;
/** The detector accepts images between 280 and 1568 px per side. */
const FRAME_LONG_SIDE = 1024;
const FRAME_MIN_SIDE = 280;
const THUMBNAIL_WIDTH = 240;

export type Reading = {
  /** Probability that the rule's condition holds in the latest frame. */
  probability: number;
  /** Whether the condition currently counts as true. */
  on: boolean;
};

export type WatchStats = {
  /** Time the detector took on the latest frame. */
  detectorMs: number;
  model: string;
};

/** Draws the current video frame onto the canvas, sized to what the detector accepts. */
function drawFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): void {
  const scale = FRAME_LONG_SIDE / Math.max(video.videoWidth, video.videoHeight);
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  // Very wide or tall sources are padded with black so the short side stays valid.
  canvas.width = Math.max(width, FRAME_MIN_SIDE);
  canvas.height = Math.max(height, FRAME_MIN_SIDE);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read frames from the video.");
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the frame."))),
      "image/jpeg",
      0.8,
    );
  });
}

function thumbnailOf(canvas: HTMLCanvasElement): string {
  const small = document.createElement("canvas");
  small.width = THUMBNAIL_WIDTH;
  small.height = Math.round((canvas.height / canvas.width) * THUMBNAIL_WIDTH);
  small.getContext("2d")?.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL("image/jpeg", 0.6);
}

/**
 * While `active`, sends the latest video frame to the detector with every enabled rule's
 * question, and calls `onFire` when a rule's condition changes from no to yes.
 */
export function useWatcher(options: {
  videoRef: RefObject<HTMLVideoElement | null>;
  rules: Rule[];
  active: boolean;
  onFire: (rule: Rule, probability: number, thumbnail: string) => void;
}) {
  const { videoRef, rules, active, onFire } = options;
  const [readings, setReadings] = useState<Record<string, Reading>>({});
  const [stats, setStats] = useState<WatchStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The loop reads these through refs so editing rules doesn't restart it.
  const rulesRef = useRef(rules);
  const onFireRef = useRef(onFire);
  useEffect(() => {
    rulesRef.current = rules;
    onFireRef.current = onFire;
  }, [rules, onFire]);

  useEffect(() => {
    if (!active) {
      setReadings({});
      setStats(null);
      setError(null);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const canvas = document.createElement("canvas");
    const triggers = new Map<string, Trigger>();

    const check = async (): Promise<void> => {
      const enabled = rulesRef.current.filter((rule) => rule.enabled);
      // A rule that is removed or switched off starts fresh if it comes back.
      for (const id of triggers.keys()) {
        if (!enabled.some((rule) => rule.id === id)) triggers.delete(id);
      }

      const video = videoRef.current;
      if (enabled.length === 0 || !video || video.readyState < 2 || !video.videoWidth) {
        setReadings((previous) => (Object.keys(previous).length ? {} : previous));
        return;
      }

      drawFrame(video, canvas);
      const form = new FormData();
      form.append("frame", await toJpeg(canvas), "frame.jpg");
      const questions: WatchQuestion[] = enabled.map(({ id, question, yes, no }) => ({ id, question, yes, no }));
      form.append("questions", JSON.stringify(questions));

      const response = await fetch("/api/watch", { method: "POST", body: form });
      const body = await response.json();
      if (cancelled) return;
      if (!response.ok) throw new Error(body.error ?? `The detector returned ${response.status}.`);

      const now = Date.now();
      const next: Record<string, Reading> = {};
      for (const rule of enabled) {
        const probability = body.answers?.[rule.id];
        if (typeof probability !== "number") continue;
        const { next: trigger, fired } = step(triggers.get(rule.id) ?? newTrigger(), probability, now);
        triggers.set(rule.id, trigger);
        next[rule.id] = { probability, on: trigger.on };
        if (fired) onFireRef.current(rule, probability, thumbnailOf(canvas));
      }
      setReadings(next);
      setStats({ detectorMs: body.ms, model: body.model });
      setError(null);
    };

    const loop = async (): Promise<void> => {
      const started = performance.now();
      let wait = MIN_INTERVAL_MS;
      try {
        await check();
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        wait = ERROR_BACKOFF_MS;
      }
      if (!cancelled) {
        timer = setTimeout(loop, Math.max(0, wait - (performance.now() - started)));
      }
    };
    void loop();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, videoRef]);

  return { readings, stats, error };
}
