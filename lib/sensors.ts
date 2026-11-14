import type { Condition, Rule, SensorKind } from "./types";

/**
 * The sensors a rule can watch. The camera sends frames. Every other sensor sends a small
 * JSON reading: numbers and labels worked out on the device, which the detector then judges
 * the same way it judges a frame.
 */

export const SENSOR_ORDER: SensorKind[] = ["camera", "sound", "location", "heart", "glucose", "motion"];

export type SoundState = {
  loudness: "quiet" | "normal" | "loud" | "very loud";
  loudness_db: number;
  peak_db_last_3_seconds: number;
  heard_in_last_15_seconds: string;
};

export type LocationState = {
  distance_from_start_m: number;
  speed_kmh: number;
  moving: boolean;
  seconds_stationary: number;
  currently_at: string[];
  saved_places: { name: string; distance_m: number }[];
  latitude: number;
  longitude: number;
  accuracy_m: number;
};

export type HeartState = {
  heart_rate_bpm: number;
  average_bpm_last_minute: number;
  lowest_bpm_last_5_minutes: number;
  highest_bpm_last_5_minutes: number;
  change_last_30_seconds_bpm: number;
};

export type GlucoseState = {
  glucose_mg_dl: number;
  glucose_mmol_l: number;
  range: "low" | "in range" | "high";
  trend: "falling quickly" | "falling" | "steady" | "rising" | "rising quickly";
  change_last_15_minutes_mg_dl: number;
  minutes_since_reading: number;
};

export type MotionState = {
  movement: "still" | "gentle movement" | "active movement" | "shaking";
  peak_acceleration_g_last_second: number;
  orientation: "flat, screen up" | "flat, screen down" | "upright" | "upside down" | "on its side" | "tilted" | "unknown";
  free_fall_in_last_3_seconds: boolean;
  impact_in_last_3_seconds: boolean;
  seconds_still: number;
};

export type SensorState = SoundState | LocationState | HeartState | GlucoseState | MotionState;

type SensorInfo = {
  label: string;
  /**
   * The words between "When" and the user's sentence, such as "the heart rate". The camera
   * has none: its sentences already read as complete after "When".
   */
  lead: string;
  /** Heading of the trigger step, ending where the user's sentence begins. */
  triggerTitle: string;
  placeholder: string;
  examples: string[];
  /** How the detector is told where a reading comes from. */
  source: string;
  /** What each field of a reading means, for the model that sharpens rules. Absent for the camera. */
  fields?: string;
};

export const SENSORS: Record<SensorKind, SensorInfo> = {
  camera: {
    label: "Camera",
    lead: "",
    triggerTitle: "When the camera sees…",
    placeholder: "someone holds up a mug",
    examples: ["someone raises their hand", "a package is on the doorstep", "a dog is on the couch"],
    source: "a camera",
  },
  sound: {
    label: "Sound",
    lead: "the microphone hears",
    triggerTitle: "When the microphone hears…",
    placeholder: "someone asking for help",
    examples: ["someone asking for help", "a very loud noise", "someone asking about the price"],
    source: "a microphone",
    fields: `- loudness: "quiet", "normal", "loud" or "very loud", right now.
- loudness_db: the level right now, in decibels below the loudest the microphone can record. 0 is the maximum and a quiet room is around -50.
- peak_db_last_3_seconds: the loudest moment in the last three seconds, on the same scale. A clap, bang or shout shows up here.
- heard_in_last_15_seconds: the words spoken near the microphone in the last fifteen seconds, as text. Empty when nobody spoke.`,
  },
  location: {
    label: "Location",
    lead: "the location",
    triggerTitle: "When the location…",
    placeholder: "is more than 200 m from where I started",
    examples: ["is more than 200 m from where I started", "is at Home", "is moving faster than 20 km/h"],
    source: "a location tracker",
    fields: `- distance_from_start_m: metres from where the device was when tracking began.
- speed_kmh: current speed in kilometres per hour.
- moving: true or false.
- seconds_stationary: how long the device has stayed in the same spot, in seconds.
- currently_at: names of the saved places the device is inside right now. Empty when it is at none of them.
- saved_places: every saved place with distance_m, its distance from the device in metres.
- latitude, longitude, accuracy_m: the raw position and its accuracy in metres.`,
  },
  heart: {
    label: "Heart rate",
    lead: "the heart rate",
    triggerTitle: "When the heart rate…",
    placeholder: "goes above 120",
    examples: ["goes above 120", "drops below 50", "jumps by more than 30 in half a minute"],
    source: "a heart-rate monitor",
    fields: `- heart_rate_bpm: beats per minute right now.
- average_bpm_last_minute: the average over the last minute.
- lowest_bpm_last_5_minutes and highest_bpm_last_5_minutes: the range over the last five minutes.
- change_last_30_seconds_bpm: how far the rate has risen (positive) or fallen (negative) over the last thirty seconds.`,
  },
  glucose: {
    label: "Glucose",
    lead: "the glucose",
    triggerTitle: "When the glucose…",
    placeholder: "drops below 70",
    examples: ["drops below 70", "goes above 180", "is falling quickly"],
    source: "a continuous glucose monitor",
    fields: `- glucose_mg_dl: blood glucose right now, in milligrams per decilitre.
- glucose_mmol_l: the same level in millimoles per litre. Use whichever unit the person used.
- range: "low" (below 70 mg/dL), "in range" or "high" (above 180 mg/dL).
- trend: "falling quickly", "falling", "steady", "rising" or "rising quickly".
- change_last_15_minutes_mg_dl: how far the level has risen (positive) or fallen (negative) over the last fifteen minutes.
- minutes_since_reading: how old the reading is, in minutes. Monitors report every five minutes.`,
  },
  motion: {
    label: "Motion",
    lead: "the device",
    triggerTitle: "When the device…",
    placeholder: "is shaken",
    examples: ["is shaken", "is lying face down", "is dropped"],
    source: "a motion sensor",
    fields: `- movement: "still", "gentle movement", "active movement" or "shaking", right now.
- peak_acceleration_g_last_second: the strongest acceleration in the last second, in g. A device at rest reads 1.
- orientation: "flat, screen up", "flat, screen down", "upright", "upside down", "on its side", "tilted" or "unknown".
- free_fall_in_last_3_seconds and impact_in_last_3_seconds: true or false. Both true together mean the device was dropped.
- seconds_still: how long the device has been still, in seconds.`,
  },
};

export function sensorOf(rule: Rule): SensorKind {
  return rule.sensor ?? "camera";
}

/** Every condition of an automation, the first one included. */
export function conditionsOf(rule: Rule): Condition[] {
  const first: Condition = {
    sensor: sensorOf(rule),
    devices: rule.devices,
    when: rule.when,
    question: rule.question,
    yes: rule.yes,
    no: rule.no,
    compiled: rule.compiled,
    note: rule.note,
  };
  return [first, ...(rule.more ?? [])];
}

/** The id under which one condition is checked and its reading is kept. */
export function conditionId(ruleId: string, index: number): string {
  return `${ruleId}#${index}`;
}

/** A condition as a phrase after "When": what the person wrote, led by the sensor's words. */
export function phraseOf(sensor: SensorKind, text: string): string {
  return `${SENSORS[sensor].lead} ${text.trim()}`.trim();
}

/** The whole "when" of an automation as one phrase, such as "a person is at the door and the heart rate goes above 120". */
export function describeWhen(rule: Rule): string {
  return conditionsOf(rule)
    .map((condition) => condition.when)
    .join(rule.join === "or" ? " or " : " and ");
}

export function isSensorKind(value: unknown): value is SensorKind {
  return typeof value === "string" && value in SENSORS;
}

/** A reading in a few words, for the run history and webhook messages. */
export function describeReading(sensor: SensorKind, state: SensorState): string {
  switch (sensor) {
    case "sound": {
      const reading = state as SoundState;
      return reading.heard_in_last_15_seconds
        ? `Heard “${reading.heard_in_last_15_seconds}”`
        : `${reading.loudness}, peak ${reading.peak_db_last_3_seconds} dB`;
    }
    case "location": {
      const reading = state as LocationState;
      const at = reading.currently_at.length ? `at ${reading.currently_at.join(", ")}, ` : "";
      return `${at}${reading.distance_from_start_m} m from start, ${reading.speed_kmh} km/h`;
    }
    case "heart":
      return `${(state as HeartState).heart_rate_bpm} bpm`;
    case "glucose": {
      const reading = state as GlucoseState;
      return `${reading.glucose_mg_dl} mg/dL, ${reading.trend}`;
    }
    case "motion": {
      const reading = state as MotionState;
      return `${reading.movement}, ${reading.orientation}`;
    }
    default:
      return "";
  }
}
