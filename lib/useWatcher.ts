"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { newTrigger, step, type Trigger } from "./trigger";
import type { Rule, WatchQuestion } from "./types";

/**
 * Timing of the checks. A check takes roughly a tenth of a second, so the delay a person
 * notices comes from when checks start, not from the detector. The loop therefore checks
 * straight away when the picture changes or a rule is waiting on its confirming reading,
 * and falls back to a slow steady pace while nothing is happening.
 */
/** How often to check while the picture is still. */
const IDLE_INTERVAL_MS = 500;
/** Shortest gap between the start of two checks: a ceiling of about ten a second. */
const MIN_INTERVAL_MS = 100;
/** How often the picture is compared with the one last checked. */
const MOTION_POLL_MS = 50;
/** Wait after a failed check, so a missing key or outage doesn't spam requests. */
const ERROR_BACKOFF_MS = 2000;

/** The picture is compared as a coarse grid of brightness values. */
const GRID_WIDTH = 64;
const GRID_HEIGHT = 36;
/** A cell counts as changed when its brightness (0–255) moves by more than this; camera noise stays below it. */
const CELL_CHANGE = 12;
/** This many changed cells means the picture has changed. */
const CHANGED_CELLS = 3;

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
  /** Checks started over the last two seconds, per second. */
  checksPerSecond: number;
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

/** A small still of what the video shows right now, or "" when it has no picture yet. */
export function snapshot(video: HTMLVideoElement | null): string {
  if (!video || video.readyState < 2 || !video.videoWidth) return "";
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = Math.round((video.videoHeight / video.videoWidth) * THUMBNAIL_WIDTH);
  canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

/** The current video frame as a coarse grid of brightness values. */
function brightnessGrid(video: HTMLVideoElement, canvas: HTMLCanvasElement): Uint8Array | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(video, 0, 0, GRID_WIDTH, GRID_HEIGHT);
  const { data } = context.getImageData(0, 0, GRID_WIDTH, GRID_HEIGHT);
  const grid = new Uint8Array(GRID_WIDTH * GRID_HEIGHT);
  for (let cell = 0; cell < grid.length; cell++) {
    grid[cell] = (data[cell * 4] + data[cell * 4 + 1] + data[cell * 4 + 2]) / 3;
  }
  return grid;
}

function hasChanged(current: Uint8Array, reference: Uint8Array): boolean {
  let changed = 0;
  for (let cell = 0; cell < current.length; cell++) {
    if (Math.abs(current[cell] - reference[cell]) > CELL_CHANGE && ++changed >= CHANGED_CELLS) return true;
  }
  return false;
}

/**
 * While `active`, sends video frames to the detector with every enabled rule's question,
 * and calls `onFire` when a rule's condition changes from no to yes.
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
    const frameCanvas = document.createElement("canvas");
    const gridCanvas = document.createElement("canvas");
    gridCanvas.width = GRID_WIDTH;
    gridCanvas.height = GRID_HEIGHT;
    const triggers = new Map<string, Trigger>();

    let checking = false;
    let lastStarted = -Infinity;
    let retryAfter = 0;
    /** The picture as it was when the latest check started. */
    let reference: Uint8Array | null = null;
    /** A rule is one reading away from changing state, so the next check should not wait. */
    let confirming = false;
    let recentStarts: number[] = [];

    /** Sends one frame to the detector. Returns whether any rule is waiting on a confirming reading. */
    const check = async (video: HTMLVideoElement, enabled: Rule[]): Promise<boolean> => {
      drawFrame(video, frameCanvas);
      const form = new FormData();
      form.append("frame", await toJpeg(frameCanvas), "frame.jpg");
      const questions: WatchQuestion[] = enabled.map(({ id, question, yes, no }) => ({ id, question, yes, no }));
      form.append("questions", JSON.stringify(questions));

      const response = await fetch("/api/watch", { method: "POST", body: form });
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
        if (fired) onFireRef.current(rule, probability, thumbnailOf(frameCanvas));
      }
      setReadings(next);
      setStats({ detectorMs: body.ms, model: body.model, checksPerSecond: recentStarts.length / 2 });
      setError(null);
      return anyPending;
    };

    /** Starts a check if one is due: the picture changed, a rule is confirming, or the idle interval passed. */
    const poll = async (): Promise<void> => {
      if (cancelled || checking) return;
      const now = performance.now();
      const sinceLast = now - lastStarted;
      if (now < retryAfter || sinceLast < MIN_INTERVAL_MS) return;

      const enabled = rulesRef.current.filter((rule) => rule.enabled);
      // A rule that is removed or switched off starts fresh if it comes back.
      for (const id of triggers.keys()) {
        if (!enabled.some((rule) => rule.id === id)) triggers.delete(id);
      }
      const video = videoRef.current;
      if (enabled.length === 0 || !video || video.readyState < 2 || !video.videoWidth) {
        setReadings((previous) => (Object.keys(previous).length ? {} : previous));
        reference = null;
        return;
      }

      const grid = brightnessGrid(video, gridCanvas);
      const changed = !grid || !reference || hasChanged(grid, reference);
      if (!confirming && !changed && sinceLast < IDLE_INTERVAL_MS) return;

      checking = true;
      lastStarted = now;
      reference = grid;
      recentStarts = [...recentStarts.filter((started) => now - started < 2000), now];
      try {
        confirming = await check(video, enabled);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        confirming = false;
        retryAfter = performance.now() + ERROR_BACKOFF_MS;
      } finally {
        checking = false;
      }
      // Don't wait for the next poll: a confirming reading or a changed picture may already be due.
      void poll();
    };

    const timer = setInterval(() => void poll(), MOTION_POLL_MS);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, videoRef]);

  return { readings, stats, error };
}
