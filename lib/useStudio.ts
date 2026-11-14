"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND_NAME } from "./brand";
import { deviceById, sourceName, type Device, type DeviceLink } from "./catalog";
import { useGlucoseSensor } from "./sensor-hooks/useGlucoseSensor";
import { useHeartSensor } from "./sensor-hooks/useHeartSensor";
import { useLocationSensor } from "./sensor-hooks/useLocationSensor";
import { useMotionSensor } from "./sensor-hooks/useMotionSensor";
import { useSoundSensor } from "./sensor-hooks/useSoundSensor";
import { conditionId, conditionsOf, describeReading, describeWhen, SENSOR_ORDER, sensorOf, type SensorState } from "./sensors";
import { COOLDOWN_MS } from "./trigger";
import type { Condition, FiredEvent, Rule, SensorKind, Settings } from "./types";
import { useStateWatcher } from "./useStateWatcher";
import { useVideoSource } from "./useVideoSource";
import { snapshot, useWatcher, type Reading } from "./useWatcher";

/** The same key the main page uses, so automations carry over between screens. */
const STORAGE_KEY = "vexo.rules";
const MAX_EVENTS = 60;
/** How much of each automation's recent readings is kept for its chart. */
const HISTORY_MS = 60_000;

/** The id of the automation being composed. It is checked like any other but never runs its action. */
export const DRAFT_ID = "draft";

/**
 * How many devices can supply each sense at the same time. Each one is a slot: its own
 * stream or readings, checked on its own, so a condition can hold on any of several devices.
 */
export const SLOTS: Record<SensorKind, number> = { camera: 3, sound: 2, location: 2, heart: 2, glucose: 2, motion: 2 };

/** Which device (an id from the catalog) holds each slot of each sense, or null for a free slot. */
export type Providers = Record<SensorKind, (string | null)[]>;

const noProviders = (): Providers =>
  Object.fromEntries(SENSOR_ORDER.map((kind) => [kind, Array<string | null>(SLOTS[kind]).fill(null)])) as Providers;

/** One check of an automation: when, how sure the detector was, and whether it counted as true. */
export type Sample = { at: number; probability: number; on: boolean };

/** What a sensor is doing right now, in the few words a list needs. */
export type SensorSummary = {
  connected: boolean;
  /** The device or feed it is connected to. */
  source: string | null;
  /** Its latest reading, such as "132 bpm". */
  value: string | null;
  /** A second line about the reading, such as "average 118". */
  note: string | null;
};

const OFF: SensorSummary = { connected: false, source: null, value: null, note: null };

/** The id under which one condition is checked on one device. */
function unitId(ruleId: string, condition: number, slot: number): string {
  return `${conditionId(ruleId, condition)}@${slot}`;
}

function speak(message: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
  return true;
}

async function sendWebhook(rule: Rule, probability: number, at: number, reading?: SensorState): Promise<string> {
  if (rule.output.kind !== "webhook") return "";
  try {
    const response = await fetch("/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: rule.output.url,
        payload: {
          // Slack displays `text` and Discord displays `content`; the rest is for Zapier and custom receivers.
          text: `${BRAND_NAME}: ${describeWhen(rule)}`,
          content: `${BRAND_NAME}: ${describeWhen(rule)}`,
          rule: describeWhen(rule),
          sensor: sensorOf(rule),
          ...(reading ? { reading } : {}),
          probability: Number(probability.toFixed(3)),
          at: new Date(at).toISOString(),
        },
      }),
    });
    const body = await response.json();
    if (body.ok) return `Webhook sent (${body.status})`;
    return body.error ?? `Webhook failed (${body.status})`;
  } catch {
    return "Webhook failed: the local server did not respond";
  }
}

/** Places a phone call or sends a text message through the server. */
async function reach(
  output: Extract<Rule["output"], { kind: "call" | "text" }>,
  when: string,
  detail: string,
  sensor: SensorKind,
): Promise<string> {
  try {
    const response = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: output.kind, to: output.to, message: output.message, when, detail, sensor }),
    });
    const body = await response.json();
    return body.result ?? body.error ?? "Could not reach the phone";
  } catch {
    return "Could not reach the phone: the local server did not respond";
  }
}

/** Asks for a video file. Resolves with null when the person closes the picker without choosing. */
function pickVideoFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Everything a screen needs to show and run automations: the sensors, the automations and
 * their live readings, the one being composed, and the history of what has run. Screens
 * differ only in how they draw it.
 */
export function useStudio() {
  // Each sense has a fixed number of slots, so the same hooks run in the same order on every render.
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoRef2 = useRef<HTMLVideoElement>(null);
  const videoRef3 = useRef<HTMLVideoElement>(null);
  const videoRefs = [videoRef, videoRef2, videoRef3];
  const videos = [useVideoSource(videoRef), useVideoSource(videoRef2), useVideoSource(videoRef3)];
  const sounds = [useSoundSensor(), useSoundSensor()];
  const locations = [useLocationSensor(), useLocationSensor()];
  const hearts = [useHeartSensor(), useHeartSensor()];
  const glucoses = [useGlucoseSensor(), useGlucoseSensor()];
  const motions = [useMotionSensor(), useMotionSensor()];
  /** The latest sensor hooks, for callbacks that must not change identity when a reading does. */
  const hooks = useRef({ videos, sounds, locations, hearts, glucoses, motions });
  hooks.current = { videos, sounds, locations, hearts, glucoses, motions };

  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [draft, setDraft] = useState<Rule | null>(null);
  /** When the draft last met its condition, so the composer can say it would have fired. */
  const [draftFiredAt, setDraftFiredAt] = useState(0);
  const [events, setEvents] = useState<FiredEvent[]>([]);
  const [fireCounts, setFireCounts] = useState<Record<string, number>>({});
  /** When each automation last fired, to light it up for a moment. */
  const [firedAt, setFiredAt] = useState<Record<string, number>>({});
  const [providers, setProviders] = useState<Providers>(noProviders);

  // Automations survive a refresh. Loaded after mount so server and client render the same first page.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRules(JSON.parse(saved));
    } catch {
      // Storage is unavailable or unreadable: start with no automations.
    }
    setRulesLoaded(true);
  }, []);
  useEffect(() => {
    if (!rulesLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {
      // Storage is unavailable: automations last for this page view only.
    }
  }, [rules, rulesLoaded]);

  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then(setSettings)
      .catch(() => {
        // Settings could not be loaded: the detector reports a missing key itself.
      });
  }, []);
  const needsDetectorKey = settings?.keys.typesafe.source === "none";

  // iPhones only let a page speak once speech has been started from a tap.
  useEffect(() => {
    const unlock = () => {
      if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  /* ---------- What each slot of each sense is doing ---------- */

  const summaries: Record<SensorKind, SensorSummary[]> = {
    camera: videos.map((video) => ({
      connected: video.source !== null,
      source: video.source?.label ?? null,
      value: video.source ? (video.source.kind === "file" ? "Replay" : "Live") : null,
      note: video.source ? { camera: "Camera", screen: "Screen or tab", file: "Video file" }[video.source.kind] : null,
    })),
    sound: sounds.map((sound) => ({
      connected: sound.connected,
      source: sound.source?.label ?? null,
      value: sound.reading ? `${sound.reading.loudness_db} dB` : null,
      note: sound.reading ? sound.reading.heard_in_last_15_seconds || sound.reading.loudness : null,
    })),
    location: locations.map((location) => ({
      connected: location.connected,
      source: location.source === "gps" ? "This device" : location.source === "simulator" ? "Simulator" : null,
      value: location.reading ? `${location.reading.distance_from_start_m} m` : null,
      note: location.reading
        ? location.reading.currently_at.length > 0
          ? `at ${location.reading.currently_at.join(", ")}`
          : "from start"
        : null,
    })),
    heart: hearts.map((heart) => ({
      connected: heart.connected,
      source: heart.source?.label ?? null,
      value: heart.reading ? `${heart.reading.heart_rate_bpm} bpm` : null,
      note: heart.reading ? `average ${heart.reading.average_bpm_last_minute}` : null,
    })),
    glucose: glucoses.map((glucose) => ({
      connected: glucose.connected,
      source: glucose.source?.label ?? null,
      value: glucose.reading ? `${glucose.reading.glucose_mg_dl} mg/dL` : null,
      note: glucose.reading ? `${glucose.reading.range}, ${glucose.reading.trend}` : null,
    })),
    motion: motions.map((motion) => ({
      connected: motion.connected,
      source: motion.source === "device" ? "This device" : motion.source === "simulator" ? "Simulator" : null,
      value: motion.reading ? motion.reading.movement : null,
      note: motion.reading ? motion.reading.orientation : null,
    })),
  };
  const errors: Record<SensorKind, (string | null)[]> = {
    camera: videos.map((item) => item.error),
    sound: sounds.map((item) => item.error),
    location: locations.map((item) => item.error),
    heart: hearts.map((item) => item.error),
    glucose: glucoses.map((item) => item.error),
    motion: motions.map((item) => item.error),
  };
  /** Each slot: whether it is connected, which device holds it, and what it reads. */
  const slots = Object.fromEntries(
    SENSOR_ORDER.map((kind) => [
      kind,
      summaries[kind].map((summary, slot) => ({ summary, connected: summary.connected, deviceId: providers[kind][slot], error: errors[kind][slot] })),
    ]),
  ) as Record<SensorKind, { summary: SensorSummary; connected: boolean; deviceId: string | null; error: string | null }[]>;
  /** Each sense as a whole: the first device that is supplying it. */
  const sensors = Object.fromEntries(
    SENSOR_ORDER.map((kind) => [kind, summaries[kind].find((summary) => summary.connected) ?? OFF]),
  ) as Record<SensorKind, SensorSummary>;

  const connectedKey = SENSOR_ORDER.map((kind) => summaries[kind].map((summary) => (summary.connected ? "1" : "0")).join("")).join("|");
  const live = useRef({ providers, connected: connectedKey });
  live.current = { providers, connected: connectedKey };

  // A slot that goes from connected to not forgets its device.
  const wasConnected = useRef(connectedKey);
  useEffect(() => {
    const before = wasConnected.current.split("|");
    wasConnected.current = connectedKey;
    const now = connectedKey.split("|");
    const dropped = SENSOR_ORDER.flatMap((kind, index) =>
      [...now[index]].flatMap((flag, slot) => (flag === "0" && before[index]?.[slot] === "1" ? [[kind, slot] as const] : [])),
    );
    if (dropped.length === 0) return;
    setProviders((previous) => {
      const next = { ...previous };
      for (const [kind, slot] of dropped) next[kind] = next[kind].map((id, index) => (index === slot ? null : id));
      return next;
    });
  }, [connectedKey]);

  /** The latest reading of one slot of a sensor that sends readings, or null. */
  const stateOf = useCallback((kind: SensorKind, slot: number): SensorState | null => {
    const { sounds: s, locations: l, hearts: h, glucoses: g, motions: m } = hooks.current;
    if (kind === "sound") return s[slot]?.getState() ?? null;
    if (kind === "location") return l[slot]?.getState() ?? null;
    if (kind === "heart") return h[slot]?.getState() ?? null;
    if (kind === "glucose") return g[slot]?.getState() ?? null;
    if (kind === "motion") return m[slot]?.getState() ?? null;
    return null;
  }, []);

  /**
   * Connects one sense of a device. It keeps the slot it already has, else takes a free one,
   * else replaces the first. Returns where it went, and whether that source has controls the
   * person now needs (a simulator's dials, a site address); null when nothing was connected.
   */
  const connect = useCallback(async (device: Device, link: DeviceLink): Promise<{ sense: SensorKind; slot: number; controls: boolean } | null> => {
    const kind = link.sense;
    const held = live.current.providers[kind].indexOf(device.id);
    const flags = live.current.connected.split("|")[SENSOR_ORDER.indexOf(kind)];
    const free = [...flags].findIndex((flag, slot) => flag === "0" && !live.current.providers[kind][slot]);
    const slot = held >= 0 ? held : free >= 0 ? free : 0;
    const take = () => setProviders((previous) => ({ ...previous, [kind]: previous[kind].map((id, index) => (index === slot ? device.id : id)) }));
    const { videos: v, sounds: s, locations: l, hearts: h, glucoses: g, motions: m } = hooks.current;

    switch (link.via) {
      case "camera":
        take();
        await v[slot].connectCamera();
        return { sense: kind, slot, controls: false };
      case "screen":
        take();
        await v[slot].connectScreen();
        return { sense: kind, slot, controls: false };
      case "file": {
        const file = await pickVideoFile();
        if (!file) return null;
        take();
        await v[slot].connectFile(file);
        return { sense: kind, slot, controls: false };
      }
      case "microphone":
        take();
        await s[slot].connect();
        return { sense: kind, slot, controls: false };
      case "gps":
        take();
        l[slot].connectGps();
        return { sense: kind, slot, controls: false };
      case "motion":
        take();
        await m[slot].connectDevice();
        return { sense: kind, slot, controls: false };
      case "bluetooth":
        take();
        await h[slot].connectBluetooth();
        return { sense: kind, slot, controls: false };
      case "nightscout":
        // Needs the site's address, which the glucose panel asks for.
        take();
        return { sense: kind, slot, controls: true };
      case "simulator":
        take();
        if (kind === "heart") h[slot].connectSimulator();
        if (kind === "glucose") g[slot].connectSimulator();
        if (kind === "motion") m[slot].connectSimulator();
        if (kind === "location") l[slot].connectSimulator();
        return { sense: kind, slot, controls: true };
    }
  }, []);

  const disconnect = useCallback((kind: SensorKind, slot: number) => {
    const { videos: v, sounds: s, locations: l, hearts: h, glucoses: g, motions: m } = hooks.current;
    const every = { camera: v, sound: s, location: l, heart: h, glucose: g, motion: m };
    every[kind][slot]?.disconnect();
  }, []);

  /* ---------- Checking ---------- */

  // The draft is watched alongside the saved automations, so it can be tried before it is turned on.
  const watched = useMemo(() => (draft ? [draft, ...rules] : rules), [draft, rules]);
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

  /** The slots a condition is checked on: every connected one, or only those of the devices it names. */
  const slotsFor = (condition: Pick<Condition, "sensor" | "devices">): number[] =>
    summaries[condition.sensor].flatMap((summary, slot) => {
      if (!summary.connected) return [];
      if (!condition.devices?.length) return [slot];
      const device = providers[condition.sensor][slot];
      return device !== null && condition.devices.includes(device) ? [slot] : [];
    });

  // Every condition, on every device it applies to, is checked as a unit of its own.
  const units = useMemo(() => {
    const bySlot: Record<string, Rule[]> = {};
    for (const kind of SENSOR_ORDER) for (let slot = 0; slot < SLOTS[kind]; slot += 1) bySlot[`${kind}@${slot}`] = [];
    for (const rule of watched) {
      conditionsOf(rule).forEach((condition, index) => {
        for (const slot of slotsFor(condition)) {
          bySlot[`${condition.sensor}@${slot}`].push({
            id: unitId(rule.id, index, slot),
            sensor: condition.sensor,
            when: condition.when,
            question: condition.question,
            yes: condition.yes,
            no: condition.no,
            compiled: condition.compiled,
            output: rule.output,
            enabled: rule.enabled,
          });
        }
      });
    }
    return bySlot;
    // `slotsFor` reads what is connected and which device holds each slot; those are the keys below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched, providers, connectedKey]);

  /** The detector's latest response time for each sensor, read when a rule fires. */
  const detectorMs = useRef<Partial<Record<SensorKind, number>>>({});
  /** The readings as of the latest render, for the firing logic. */
  const readingsRef = useRef<Record<string, Reading>>({});
  const lastFired = useRef<Record<string, number>>({});

  type Evidence = { thumbnail?: string; state?: SensorState };

  /** Runs an automation's action and logs it. */
  const run = useCallback((rule: Rule, probability: number, kind: SensorKind, thumbnail: string, detail: string, state?: SensorState) => {
    if (rule.id === DRAFT_ID) {
      setDraftFiredAt(Date.now());
      return;
    }
    const when = describeWhen(rule);
    const event: FiredEvent = {
      id: crypto.randomUUID(),
      ruleId: rule.id,
      when,
      at: Date.now(),
      probability,
      sensor: kind,
      thumbnail,
      detail,
      result: "",
      question: conditionsOf(rule)
        .map((condition) => condition.question)
        .join(rule.join === "or" ? " OR " : " AND "),
      detectorMs: detectorMs.current[kind],
    };
    const record = (result: string, actionMs?: number) =>
      setEvents((previous) => {
        const known = previous.some((item) => item.id === event.id);
        const next = known
          ? previous.map((item) => (item.id === event.id ? { ...item, result, actionMs } : item))
          : [{ ...event, result, actionMs }, ...previous];
        return next.slice(0, MAX_EVENTS);
      });

    setFireCounts((previous) => ({ ...previous, [rule.id]: (previous[rule.id] ?? 0) + 1 }));
    setFiredAt((previous) => ({ ...previous, [rule.id]: event.at }));

    if (rule.output.kind === "speak") {
      const spoken = speak(rule.output.message);
      record(spoken ? `Said “${rule.output.message}”` : "This browser cannot speak, so it was only logged", 0);
      return;
    }
    const started = performance.now();
    if (rule.output.kind === "webhook") {
      record("Sending webhook…");
      void sendWebhook(rule, probability, event.at, state).then((result) => record(result, Math.round(performance.now() - started)));
      return;
    }
    record(rule.output.kind === "call" ? "Calling…" : "Sending text…");
    void reach(rule.output, when, detail, kind).then((result) => record(result, Math.round(performance.now() - started)));
  }, []);

  /**
   * One condition has just become true on one device. The automation runs if that makes
   * the whole of it true: with "and" every other condition must already hold, with "or" none may.
   */
  const handleUnit = useCallback(
    (unit: Rule, probability: number, evidence: Evidence) => {
      const match = /^(.*)#(\d+)@(\d+)$/.exec(unit.id);
      if (!match) return;
      const ruleId = match[1];
      const index = Number(match[2]);
      const slot = Number(match[3]);
      const rule = watchedRef.current.find((item) => item.id === ruleId);
      if (!rule) return;
      const now = readingsRef.current;
      const conditions = conditionsOf(rule);
      const onDevices = Object.keys(now).filter((key) => key.startsWith(`${ruleId}#`) && key.includes("@"));

      // The condition already held through another device, so nothing has changed.
      const prefix = `${conditionId(ruleId, index)}@`;
      if (onDevices.some((key) => key.startsWith(prefix) && key !== unit.id && now[key].on)) return;
      const others = conditions.flatMap((_, other) => (other === index ? [] : [now[conditionId(ruleId, other)]?.on === true]));
      if (rule.join === "or" ? others.some(Boolean) : !others.every(Boolean)) return;
      if (Date.now() - (lastFired.current[ruleId] ?? 0) < COOLDOWN_MS) return;
      lastFired.current[ruleId] = Date.now();

      const kind = conditions[index].sensor;
      // Say which device it was when this condition is watched on more than one.
      const watchedOn = new Set([...onDevices.filter((key) => key.startsWith(prefix)), unit.id]).size;
      const source = watchedOn > 1 ? deviceById(live.current.providers[kind][slot] ?? undefined) : undefined;
      const device = source ? sourceName(source) : undefined;
      const reading = evidence.state ? describeReading(kind, evidence.state) : "";
      const detail = [device, reading].filter(Boolean).join(": ");

      // A picture of the moment, from a camera this automation watches when the condition that tipped it was not one.
      let thumbnail = evidence.thumbnail ?? "";
      if (!thumbnail) {
        const camera = onDevices.find((key) => conditions[Number(/#(\d+)@/.exec(key)?.[1])]?.sensor === "camera");
        if (camera) thumbnail = snapshot(videoRefs[Number(camera.split("@")[1])].current);
      }
      run(rule, probability, kind, thumbnail, detail, evidence.state);
    },
    // The refs are stable; `videoRefs` is rebuilt on every render from the same three refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run],
  );

  const fromFrame = useCallback((unit: Rule, probability: number, thumbnail: string) => handleUnit(unit, probability, { thumbnail }), [handleUnit]);
  const fromReading = useCallback((unit: Rule, probability: number, state: SensorState) => handleUnit(unit, probability, { state }), [handleUnit]);

  // Without a detector key every check would fail, so wait for one.
  const canDetect = !needsDetectorKey;
  const cameraWatchers = [
    useWatcher({ videoRef, rules: units["camera@0"], active: videos[0].source !== null && canDetect, onFire: fromFrame }),
    useWatcher({ videoRef: videoRef2, rules: units["camera@1"], active: videos[1].source !== null && canDetect, onFire: fromFrame }),
    useWatcher({ videoRef: videoRef3, rules: units["camera@2"], active: videos[2].source !== null && canDetect, onFire: fromFrame }),
  ];
  const soundWatchers = [
    useStateWatcher({ sensor: "sound", rules: units["sound@0"], active: sounds[0].connected && canDetect, getState: sounds[0].getState, onFire: fromReading }),
    useStateWatcher({ sensor: "sound", rules: units["sound@1"], active: sounds[1].connected && canDetect, getState: sounds[1].getState, onFire: fromReading }),
  ];
  const locationWatchers = [
    useStateWatcher({ sensor: "location", rules: units["location@0"], active: locations[0].connected && canDetect, getState: locations[0].getState, onFire: fromReading }),
    useStateWatcher({ sensor: "location", rules: units["location@1"], active: locations[1].connected && canDetect, getState: locations[1].getState, onFire: fromReading }),
  ];
  const heartWatchers = [
    useStateWatcher({ sensor: "heart", rules: units["heart@0"], active: hearts[0].connected && canDetect, getState: hearts[0].getState, onFire: fromReading }),
    useStateWatcher({ sensor: "heart", rules: units["heart@1"], active: hearts[1].connected && canDetect, getState: hearts[1].getState, onFire: fromReading }),
  ];
  const glucoseWatchers = [
    useStateWatcher({ sensor: "glucose", rules: units["glucose@0"], active: glucoses[0].connected && canDetect, getState: glucoses[0].getState, onFire: fromReading }),
    useStateWatcher({ sensor: "glucose", rules: units["glucose@1"], active: glucoses[1].connected && canDetect, getState: glucoses[1].getState, onFire: fromReading }),
  ];
  const motionWatchers = [
    useStateWatcher({ sensor: "motion", rules: units["motion@0"], active: motions[0].connected && canDetect, getState: motions[0].getState, onFire: fromReading }),
    useStateWatcher({ sensor: "motion", rules: units["motion@1"], active: motions[1].connected && canDetect, getState: motions[1].getState, onFire: fromReading }),
  ];

  type Watcher = { readings: Record<string, Reading>; stats: { detectorMs: number; checksPerSecond: number } | null; error: string | null };
  const watchers: Record<SensorKind, Watcher[]> = {
    camera: cameraWatchers,
    sound: soundWatchers,
    location: locationWatchers,
    heart: heartWatchers,
    glucose: glucoseWatchers,
    motion: motionWatchers,
  };
  const everyWatcher = SENSOR_ORDER.flatMap((kind) => watchers[kind]);
  for (const kind of SENSOR_ORDER) detectorMs.current[kind] = watchers[kind].find((watcher) => watcher.stats)?.stats?.detectorMs;

  /**
   * The live answers, at three levels: one device (`rule#0@1`), one condition across its
   * devices (`rule#0`), and the whole automation (`rule`).
   */
  const readings: Record<string, Reading> = Object.assign({}, ...everyWatcher.map((watcher) => watcher.readings));
  for (const rule of watched) {
    const conditions = conditionsOf(rule);
    const parts = conditions.map((condition, index) => {
      const onDevices = Array.from({ length: SLOTS[condition.sensor] }, (_, slot) => readings[unitId(rule.id, index, slot)]).filter(Boolean);
      if (onDevices.length === 0) return undefined;
      const reading = { probability: Math.max(...onDevices.map((item) => item.probability)), on: onDevices.some((item) => item.on) };
      readings[conditionId(rule.id, index)] = reading;
      return reading;
    });
    if (parts.every((part) => part === undefined)) continue;
    // A condition with no reading yet counts as not holding.
    const probabilities = parts.map((part) => part?.probability ?? 0);
    const any = rule.join === "or";
    readings[rule.id] = {
      probability: any ? Math.max(...probabilities) : Math.min(...probabilities),
      on: any ? parts.some((part) => part?.on === true) : parts.every((part) => part?.on === true),
    };
  }
  readingsRef.current = readings;

  const detectorError = everyWatcher.map((watcher) => watcher.error).find((error) => error !== null) ?? null;
  const latestDetectorMs = everyWatcher.map((watcher) => watcher.stats?.detectorMs).find((ms) => ms !== undefined);
  const checksPerSecond = everyWatcher.reduce((total, watcher) => total + (watcher.stats?.checksPerSecond ?? 0), 0);

  // Each watcher's readings object is replaced on every check, so a change marks a check.
  const [history, setHistory] = useState<Record<string, Sample[]>>({});
  const [checks, setChecks] = useState<Record<SensorKind, number>>({ camera: 0, sound: 0, location: 0, heart: 0, glucose: 0, motion: 0 });
  const seen = useRef<Record<string, Reading>[]>([]);
  useEffect(() => {
    const now = Date.now();
    const changed = SENSOR_ORDER.filter((kind) => {
      let any = false;
      for (const watcher of watchers[kind]) {
        const index = everyWatcher.indexOf(watcher);
        if (seen.current[index] !== watcher.readings && Object.keys(watcher.readings).length > 0) any = true;
        seen.current[index] = watcher.readings;
      }
      return any;
    });
    if (changed.length === 0) return;
    setChecks((previous) => {
      const next = { ...previous };
      for (const kind of changed) next[kind] += 1;
      return next;
    });
    setHistory((previous) => {
      const next: Record<string, Sample[]> = {};
      // Automations whose sensor is not sending keep their chart until it ages out.
      for (const [id, samples] of Object.entries(previous)) {
        const recent = samples.filter((sample) => sample.at >= now - HISTORY_MS);
        if (recent.length > 0) next[id] = recent;
      }
      // The chart is of the whole automation, so every one a changed sensor feeds gets a point.
      for (const rule of watchedRef.current) {
        const reading = readingsRef.current[rule.id];
        if (!reading || !conditionsOf(rule).some((condition) => changed.includes(condition.sensor))) continue;
        next[rule.id] = [...(next[rule.id] ?? []), { at: now, probability: reading.probability, on: reading.on }];
      }
      return next;
    });
    // The watchers' readings objects are the real dependencies; the lists holding them are rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, everyWatcher.map((watcher) => watcher.readings));

  /* ---------- The automations ---------- */

  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const addRule = useCallback((rule: Rule) => setRules((previous) => [rule, ...previous]), []);
  const deleteRule = useCallback((id: string) => setRules((previous) => previous.filter((rule) => rule.id !== id)), []);
  /** Switching one off keeps a still of what its sensors showed, which stands in for the live feed until it is back on. */
  const toggleRule = useCallback(
    (id: string) => {
      const rule = rulesRef.current.find((item) => item.id === id);
      if (!rule) return;
      if (!rule.enabled) {
        setRules((previous) => previous.map((item) => (item.id === id ? { ...item, enabled: true, paused: undefined } : item)));
        return;
      }
      const now = readingsRef.current;
      let thumbnail = "";
      const details: string[] = [];
      conditionsOf(rule).forEach((condition, index) => {
        const slot = Array.from({ length: SLOTS[condition.sensor] }, (_, item) => item).find((item) => now[unitId(id, index, item)]);
        if (slot === undefined) return;
        if (condition.sensor === "camera") thumbnail ||= snapshot(videoRefs[slot].current);
        else {
          const state = stateOf(condition.sensor, slot);
          if (state) details.push(describeReading(condition.sensor, state));
        }
      });
      setRules((previous) => previous.map((item) => (item.id === id ? { ...item, enabled: false, paused: { thumbnail, detail: details.join(" · ") } } : item)));
    },
    // The refs are stable; `videoRefs` is rebuilt on every render from the same three refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stateOf],
  );

  return {
    /** The one real <video> per camera slot, which the detector reads. */
    videoRefs,
    videoRef,
    /** The sensor hooks of the first slot of each sense, for the panels that connect and simulate them. */
    devices: { video: videos[0], sound: sounds[0], location: locations[0], heart: hearts[0], glucose: glucoses[0], motion: motions[0] },
    /** Every slot's hooks, for showing or controlling a device other than the first. */
    all: { video: videos, sound: sounds, location: locations, heart: hearts, glucose: glucoses, motion: motions },
    sensors,
    slots,
    providers,
    connect,
    disconnect,
    slotsFor,
    rules,
    readings,
    history,
    checks,
    events,
    fireCounts,
    firedAt,
    draft,
    setDraft,
    draftFiredAt,
    addRule,
    toggleRule,
    deleteRule,
    settings,
    setSettings,
    needsDetectorKey,
    detectorError,
    detectorMs: latestDetectorMs,
    checksPerSecond,
  };
}

export type Studio = ReturnType<typeof useStudio>;

/**
 * The studio as seen through one slot of one sense: `devices`, `sensors` and `videoRef`
 * refer to that slot, so anything written for a single device shows or controls this one.
 */
export function scopeStudio(studio: Studio, kind: SensorKind, slot: number): Studio {
  const name = kind === "camera" ? "video" : kind;
  return {
    ...studio,
    videoRef: kind === "camera" ? studio.videoRefs[slot] : studio.videoRef,
    devices: { ...studio.devices, [name]: studio.all[name][slot] },
    sensors: { ...studio.sensors, [kind]: studio.slots[kind][slot].summary },
  };
}

/** The first slot of a sense that has a device connected, or 0. */
export function firstSlot(studio: Studio, kind: SensorKind): number {
  return Math.max(0, studio.slots[kind].findIndex((slot) => slot.connected));
}
