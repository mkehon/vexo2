"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { conditionId, conditionsOf, outputsOf, phraseOf, SENSOR_ORDER, SENSORS } from "./sensors";
import type { Template } from "./templates";
import type { CompiledRule, Condition, Output, Rule, SensorKind } from "./types";
import { DRAFT_ID, type Studio } from "./useStudio";

/** How long to wait after the last keystroke before working a condition out. */
const SETTLE_MS = 500;
/** Shorter text is not worth sending. */
const MIN_LENGTH = 3;
const MAX_CONDITIONS = 4;
const PHONE_KEY = "vexo.phone";

/** What an automation can do, in the order the builder offers them. Several can be chosen together. */
export const ACTIONS = ["call", "text", "speak", "alarm", "webhook"] as const;
export type ActionKind = (typeof ACTIONS)[number];

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** One row of the builder's IF: a sensor, what to watch for, and the devices to watch it on. */
export type DraftCondition = {
  key: string;
  sensor: SensorKind;
  /** What the person typed after the sensor's lead, such as "goes above 120". */
  text: string;
  /** The sources it is checked on, by id. A new row has none: the person picks what it watches. */
  devices: string[];
  /** The check worked out from the text, and the sensor and text it was worked out for. */
  compiled: CompiledRule | null;
  compiledFor: string;
};

const signature = (condition: Pick<DraftCondition, "sensor" | "text">) => `${condition.sensor}|${condition.text.trim()}`;
const isReady = (condition: DraftCondition) => condition.compiled !== null && condition.compiledFor === signature(condition);
/** Rows are numbered rather than given random ids, so the first one is the same on the server and in the browser. */
let rowsMade = 0;
const blank = (sensor: SensorKind = "camera"): DraftCondition => ({ key: `row-${(rowsMade += 1)}`, sensor, text: "", devices: [], compiled: null, compiledFor: "" });

/** Loose check that something is a phone number: digits, at least seven of them. */
function isPhone(value: string): boolean {
  return /^\+?[\d\s().-]{7,}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

function toCondition(draft: DraftCondition): Condition {
  const compiled = draft.compiled!;
  return {
    sensor: draft.sensor,
    ...(draft.devices.length ? { devices: draft.devices } : {}),
    when: phraseOf(draft.sensor, draft.text),
    question: compiled.question,
    yes: compiled.yes,
    no: compiled.no,
    compiled: compiled.compiled,
    ...(compiled.note ? { note: compiled.note } : {}),
  };
}

function toRule(id: string, ready: DraftCondition[], join: "and" | "or", outputs: Output[], name = ""): Rule {
  const [first, ...more] = ready.map(toCondition);
  const [output, ...also] = outputs;
  return {
    id,
    ...(name.trim() ? { name: name.trim() } : {}),
    ...first,
    ...(more.length > 0 ? { more, join } : {}),
    output,
    ...(also.length > 0 ? { also } : {}),
    enabled: true,
  };
}

/**
 * Creating an automation as IF … THEN …: one or more conditions, joined by AND or OR, and a
 * call or a text. Each condition is worked out into a check as it is typed, and the checks
 * run live as a draft, so the automation can be tried before it is turned on.
 */
export function useComposer(studio: Studio) {
  const { setDraft, addRule, updateRule } = studio;
  /** The id of the automation being edited, or null when a new one is being made. */
  const [editing, setEditing] = useState<string | null>(null);
  /** The address a webhook is sent to, and the app it was set up for when the automation being edited named one. */
  const [url, setUrl] = useState("");
  const [webhookApp, setWebhookApp] = useState<string | undefined>(undefined);
  const [conditions, setConditions] = useState<DraftCondition[]>(() => [blank()]);
  /** The name the person gave it. Left empty, it is named after what it watches for. */
  const [name, setName] = useState("");
  const [join, setJoin] = useState<"and" | "or">("and");
  const [actions, setActions] = useState<ActionKind[]>(["call"]);
  /** The actions chosen before an automation was opened for editing, put back when the edit ends. */
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const beforeEdit = useRef<ActionKind[] | null>(null);
  /** What the person typed as the message; until they do, it is written from the conditions. */
  const [typedMessage, setTypedMessage] = useState<string | null>(null);
  /** The number to call or text. Remembered, so it is typed once. */
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPhone(localStorage.getItem(PHONE_KEY) ?? "");
    } catch {
      // Storage is unavailable: the number has to be typed each time.
    }
  }, []);

  // Works out each condition a moment after its sensor or text last changed.
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const timers = conditions
      .filter((condition) => condition.text.trim().length >= MIN_LENGTH && !isReady(condition) && !asked.current.has(`${condition.key}|${signature(condition)}`))
      .map((condition) => {
        const wanted = signature(condition);
        const ticket = `${condition.key}|${wanted}`;
        return setTimeout(async () => {
          asked.current.add(ticket);
          let compiled: CompiledRule;
          try {
            const response = await fetch("/api/compile", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ when: phraseOf(condition.sensor, condition.text), sensor: condition.sensor }),
            });
            compiled = await response.json();
            if (!response.ok) throw new Error((compiled as { error?: string }).error);
          } catch {
            // The server could not be reached: check the words as written, so the automation can still be made.
            const when = phraseOf(condition.sensor, condition.text);
            compiled = { question: `Does this hold: ${when}?`, yes: "", no: "", say: `Detected: ${when}`, compiled: false, note: "Checked as written." };
          }
          asked.current.delete(ticket);
          setConditions((previous) => previous.map((item) => (item.key === condition.key && signature(item) === wanted ? { ...item, compiled, compiledFor: wanted } : item)));
        }, SETTLE_MS);
      });
    return () => timers.forEach(clearTimeout);
  }, [conditions]);

  // The conditions that are worked out and have a device run as a draft against the live sensors.
  const ready = conditions.filter((condition) => isReady(condition) && condition.devices.length > 0);
  const draftKey = JSON.stringify([join, ready.map((condition) => [condition.sensor, condition.devices, condition.text.trim(), condition.compiled?.question])]);
  const latest = useRef({ ready, join });
  latest.current = { ready, join };
  useEffect(() => {
    const { ready: now, join: how } = latest.current;
    setDraft(now.length > 0 ? toRule(DRAFT_ID, now, how, [{ kind: "speak", message: "" }]) : null);
  }, [draftKey, setDraft]);

  /** The sources connected for a sensor right now, by id. */
  const slotsRef = useRef(studio.slots);
  slotsRef.current = studio.slots;
  const connectedFor = useCallback((sensor: SensorKind) => slotsRef.current[sensor].flatMap((slot) => (slot.connected && slot.deviceId ? [slot.deviceId] : [])), []);

  const change = useCallback((key: string, update: (condition: DraftCondition) => DraftCondition) => {
    setError(null);
    setConditions((previous) => previous.map((condition) => (condition.key === key ? update(condition) : condition)));
  }, []);
  const setSensor = useCallback((key: string, sensor: SensorKind) => change(key, (condition) => ({ ...condition, sensor, devices: [] })), [change]);
  const setText = useCallback((key: string, text: string) => change(key, (condition) => ({ ...condition, text })), [change]);
  const setDevices = useCallback((key: string, devices: string[]) => change(key, (condition) => ({ ...condition, devices })), [change]);
  const addCondition = useCallback(
    () =>
      setConditions((previous) => {
        if (previous.length >= MAX_CONDITIONS) return previous;
        // Starts on a sensor that is not in use yet, since two conditions on different senses is the common case.
        const unused = SENSOR_ORDER.find((kind) => !previous.some((condition) => condition.sensor === kind));
        return [...previous, blank(unused)];
      }),
    [],
  );
  const removeCondition = useCallback((key: string) => setConditions((previous) => (previous.length > 1 ? previous.filter((condition) => condition.key !== key) : previous)), []);

  const discard = useCallback(() => {
    setName("");
    setConditions([blank()]);
    setJoin("and");
    setTypedMessage(null);
    setError(null);
    setEditing(null);
    setUrl("");
    setWebhookApp(undefined);
    if (beforeEdit.current) setActions(beforeEdit.current);
    beforeEdit.current = null;
    setDraft(null);
  }, [setDraft]);

  /** Switches one action on or off. At least one stays on. */
  const toggleAction = useCallback((kind: ActionKind) => {
    setError(null);
    setActions((previous) => {
      const next = previous.includes(kind) ? previous.filter((item) => item !== kind) : [...previous, kind];
      return next.length > 0 ? ACTIONS.filter((item) => next.includes(item)) : previous;
    });
  }, []);

  /** Fills the builder with an existing automation, to change it. Its checks are reused as they are. */
  const load = useCallback((rule: Rule) => {
    setConditions(
      conditionsOf(rule).map((condition) => {
        // The row shows the sensor's lead itself, so it is taken off the saved phrase.
        const lead = SENSORS[condition.sensor].lead;
        const text = lead && condition.when.toLowerCase().startsWith(`${lead.toLowerCase()} `) ? condition.when.slice(lead.length + 1) : condition.when;
        const row = { ...blank(condition.sensor), text, devices: condition.devices?.length ? condition.devices : connectedFor(condition.sensor) };
        const compiled: CompiledRule = { question: condition.question, yes: condition.yes, no: condition.no, say: "", compiled: condition.compiled, note: condition.note };
        return { ...row, compiled, compiledFor: signature(row) };
      }),
    );
    setName(rule.name ?? "");
    setJoin(rule.join ?? "and");
    beforeEdit.current ??= actionsRef.current;
    const outputs = outputsOf(rule);
    setActions(ACTIONS.filter((kind) => outputs.some((output) => output.kind === kind)));
    for (const output of outputs) {
      if (output.kind === "call" || output.kind === "text") setPhone(output.to);
      if (output.kind === "webhook") {
        setUrl(output.url);
        setWebhookApp(output.app);
      }
    }
    const worded = outputs.find((output) => output.kind === "call" || output.kind === "text" || output.kind === "speak");
    setTypedMessage(worded && "message" in worded ? worded.message : null);
    setEditing(rule.id);
    setError(null);
  }, [connectedFor]);

  const applyTemplate = useCallback((template: Template) => {
    setName(template.title);
    setConditions(template.conditions.map((condition) => ({ ...blank(condition.sensor), text: condition.text })));
    setJoin(template.join ?? "and");
    setActions([template.action]);
    setTypedMessage(template.message);
    setError(null);
    // A template is a new automation: chosen while editing, it leaves the one being edited as it was.
    setEditing(null);
    setUrl("");
    setWebhookApp(undefined);
    beforeEdit.current = null;
  }, []);

  // Until the person writes a message, it says what was detected.
  const says = conditions
    .filter(isReady)
    .map((condition) => (condition.compiled?.say ?? "").trim().replace(/[.!]$/, ""))
    .filter(Boolean);
  const written = says.length > 0 ? `${says.map((say, index) => (index === 0 ? say : say[0].toLowerCase() + say.slice(1))).join(join === "or" ? " or " : " and ")}.` : "";
  const message = typedMessage ?? written;

  /**
   * Turns the automation on. Returns false, with `error` set, when something is missing.
   * While editing, it replaces the automation being edited unless `asNew` asks for a separate one.
   */
  const turnOn = useCallback((asNew = false): boolean => {
    const filled = conditions.filter((condition) => condition.text.trim().length > 0);
    if (filled.length === 0) {
      setError("Say what to watch for: pick a sensor and finish its sentence.");
      return false;
    }
    if (!filled.every(isReady)) {
      setError("Still working out what to check. Try again in a moment.");
      return false;
    }
    if (!filled.every((condition) => condition.devices.length > 0)) {
      setError(filled.length > 1 ? "Pick a device for each condition, so the automation knows what to watch." : "Pick a device, so the automation knows what to watch.");
      return false;
    }
    const reaches = actions.includes("call") || actions.includes("text");
    if (reaches && !isPhone(phone)) {
      setError("Enter the phone number to reach, with its country code, such as +1 415 555 0100.");
      return false;
    }
    if (actions.includes("webhook") && !isHttpUrl(url.trim())) {
      setError("Paste the address to send the webhook to, starting with https://");
      return false;
    }
    if (reaches) {
      try {
        localStorage.setItem(PHONE_KEY, phone.trim());
      } catch {
        // Storage is unavailable: nothing to remember.
      }
    }
    const said = message.trim() || "An automation fired.";
    const outputs = actions.map((kind): Output => {
      if (kind === "call" || kind === "text") return { kind, to: phone.trim(), message: said };
      if (kind === "speak") return { kind, message: said };
      if (kind === "alarm") return { kind };
      return { kind, url: url.trim(), ...(webhookApp ? { app: webhookApp } : {}) };
    });
    if (editing && !asNew) updateRule(toRule(editing, filled, join, outputs, name));
    else addRule(toRule(crypto.randomUUID(), filled, join, outputs, name));
    discard();
    return true;
  }, [actions, addRule, conditions, discard, editing, join, message, name, phone, updateRule, url, webhookApp]);

  return {
    name,
    setName,
    conditions,
    setSensor,
    setText,
    setDevices,
    addCondition,
    removeCondition,
    canAdd: conditions.length < MAX_CONDITIONS,
    join,
    setJoin,
    actions,
    toggleAction,
    url,
    setUrl,
    message,
    setMessage: setTypedMessage,
    phone,
    setPhone,
    error,
    discard,
    applyTemplate,
    load,
    /** The id of the automation being edited, or null. */
    editing,
    turnOn,
    /** Whether a row's check is still being worked out. */
    isThinking: (condition: DraftCondition) => condition.text.trim().length >= MIN_LENGTH && !isReady(condition),
    /** The id a row's live answer is kept under, or null until its check is worked out. */
    readingId: (condition: DraftCondition) => {
      const index = ready.indexOf(condition);
      return index >= 0 ? conditionId(DRAFT_ID, index) : null;
    },
    /** How sure the detector is right now that the whole of it holds. */
    reading: studio.readings[DRAFT_ID],
    history: studio.history[DRAFT_ID],
    wouldHaveFiredAt: studio.draftFiredAt,
  };
}

export type Composer = ReturnType<typeof useComposer>;
