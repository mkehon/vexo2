"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { conditionId, phraseOf, SENSOR_ORDER } from "./sensors";
import type { Template } from "./templates";
import type { CompiledRule, Condition, Rule, SensorKind } from "./types";
import { DRAFT_ID, type Studio } from "./useStudio";

/** How long to wait after the last keystroke before working a condition out. */
const SETTLE_MS = 500;
/** Shorter text is not worth sending. */
const MIN_LENGTH = 3;
const MAX_CONDITIONS = 4;
const PHONE_KEY = "vexo.phone";

/** One row of the builder's IF: a sensor, what to watch for, and the devices to watch it on. */
export type DraftCondition = {
  key: string;
  sensor: SensorKind;
  /** What the person typed after the sensor's lead, such as "goes above 120". */
  text: string;
  /** The devices it is checked on, or null for every device connected for the sensor. */
  devices: string[] | null;
  /** The check worked out from the text, and the sensor and text it was worked out for. */
  compiled: CompiledRule | null;
  compiledFor: string;
};

const signature = (condition: Pick<DraftCondition, "sensor" | "text">) => `${condition.sensor}|${condition.text.trim()}`;
const isReady = (condition: DraftCondition) => condition.compiled !== null && condition.compiledFor === signature(condition);
/** Rows are numbered rather than given random ids, so the first one is the same on the server and in the browser. */
let rowsMade = 0;
const blank = (sensor: SensorKind = "camera"): DraftCondition => ({ key: `row-${(rowsMade += 1)}`, sensor, text: "", devices: null, compiled: null, compiledFor: "" });

/** Loose check that something is a phone number: digits, at least seven of them. */
function isPhone(value: string): boolean {
  return /^\+?[\d\s().-]{7,}$/.test(value.trim()) && value.replace(/\D/g, "").length >= 7;
}

function toCondition(draft: DraftCondition): Condition {
  const compiled = draft.compiled!;
  return {
    sensor: draft.sensor,
    ...(draft.devices?.length ? { devices: draft.devices } : {}),
    when: phraseOf(draft.sensor, draft.text),
    question: compiled.question,
    yes: compiled.yes,
    no: compiled.no,
    compiled: compiled.compiled,
    ...(compiled.note ? { note: compiled.note } : {}),
  };
}

function toRule(id: string, ready: DraftCondition[], join: "and" | "or", output: Rule["output"]): Rule {
  const [first, ...more] = ready.map(toCondition);
  return { id, ...first, ...(more.length > 0 ? { more, join } : {}), output, enabled: true };
}

/**
 * Creating an automation as IF … THEN …: one or more conditions, joined by AND or OR, and a
 * call or a text. Each condition is worked out into a check as it is typed, and the checks
 * run live as a draft, so the automation can be tried before it is turned on.
 */
export function useComposer(studio: Studio) {
  const { setDraft, addRule } = studio;
  const [conditions, setConditions] = useState<DraftCondition[]>(() => [blank()]);
  const [join, setJoin] = useState<"and" | "or">("and");
  const [action, setAction] = useState<"call" | "text">("call");
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

  // The conditions that are worked out run as a draft against the live sensors.
  const ready = conditions.filter(isReady);
  const draftKey = JSON.stringify([join, ready.map((condition) => [condition.sensor, condition.devices, condition.text.trim(), condition.compiled?.question])]);
  const latest = useRef({ ready, join });
  latest.current = { ready, join };
  useEffect(() => {
    const { ready: now, join: how } = latest.current;
    setDraft(now.length > 0 ? toRule(DRAFT_ID, now, how, { kind: "speak", message: "" }) : null);
  }, [draftKey, setDraft]);

  const change = useCallback((key: string, update: (condition: DraftCondition) => DraftCondition) => {
    setError(null);
    setConditions((previous) => previous.map((condition) => (condition.key === key ? update(condition) : condition)));
  }, []);
  const setSensor = useCallback((key: string, sensor: SensorKind) => change(key, (condition) => ({ ...condition, sensor, devices: null })), [change]);
  const setText = useCallback((key: string, text: string) => change(key, (condition) => ({ ...condition, text })), [change]);
  const setDevices = useCallback((key: string, devices: string[] | null) => change(key, (condition) => ({ ...condition, devices: devices?.length ? devices : null })), [change]);
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
    setConditions([blank()]);
    setJoin("and");
    setTypedMessage(null);
    setError(null);
    setDraft(null);
  }, [setDraft]);

  const applyTemplate = useCallback((template: Template) => {
    setConditions(template.conditions.map((condition) => ({ ...blank(condition.sensor), text: condition.text })));
    setJoin(template.join ?? "and");
    setAction(template.action);
    setTypedMessage(template.message);
    setError(null);
  }, []);

  // Until the person writes a message, it says what was detected.
  const says = ready.map((condition) => (condition.compiled?.say ?? "").trim().replace(/[.!]$/, "")).filter(Boolean);
  const written = says.length > 0 ? `${says.map((say, index) => (index === 0 ? say : say[0].toLowerCase() + say.slice(1))).join(join === "or" ? " or " : " and ")}.` : "";
  const message = typedMessage ?? written;

  /** Turns the automation on. Returns false, with `error` set, when something is missing. */
  const turnOn = useCallback((): boolean => {
    const filled = conditions.filter((condition) => condition.text.trim().length > 0);
    if (filled.length === 0) {
      setError("Say what to watch for: pick a sensor and finish its sentence.");
      return false;
    }
    if (!filled.every(isReady)) {
      setError("Still working out what to check. Try again in a moment.");
      return false;
    }
    if (!isPhone(phone)) {
      setError("Enter the phone number to reach, with its country code, such as +1 415 555 0100.");
      return false;
    }
    try {
      localStorage.setItem(PHONE_KEY, phone.trim());
    } catch {
      // Storage is unavailable: nothing to remember.
    }
    addRule(toRule(crypto.randomUUID(), filled, join, { kind: action, to: phone.trim(), message: message.trim() || "An automation fired." }));
    discard();
    return true;
  }, [action, addRule, conditions, discard, join, message, phone]);

  return {
    conditions,
    setSensor,
    setText,
    setDevices,
    addCondition,
    removeCondition,
    canAdd: conditions.length < MAX_CONDITIONS,
    join,
    setJoin,
    action,
    setAction,
    message,
    setMessage: setTypedMessage,
    phone,
    setPhone,
    error,
    discard,
    applyTemplate,
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
