import type { SensorKind } from "./types";

/**
 * Ready-made automations for the gallery. Choosing one fills the builder's rows, which are
 * then worked out like anything typed by hand; nothing here is special-cased.
 */

export type Template = {
  id: string;
  category: "Safety" | "Health" | "Home" | "Work";
  title: string;
  /** What it does and why someone would want it, in one or two sentences. */
  description: string;
  /** The conditions: a sensor, and the words that follow its lead ("the heart rate …"). */
  conditions: { sensor: SensorKind; text: string }[];
  /** How the conditions combine when there are several. */
  join?: "and" | "or";
  action: "call" | "text";
  /** What the voice says or the text reads. */
  message: string;
};

export const TEMPLATE_CATEGORIES: Template["category"][] = ["Safety", "Health", "Home", "Work"];

export const TEMPLATES: Template[] = [
  {
    id: "fall",
    category: "Safety",
    title: "Hard fall",
    description: "If the device is dropped while your heart is racing, your phone rings and a voice tells you what happened.",
    conditions: [
      { sensor: "motion", text: "is dropped" },
      { sensor: "heart", text: "is above 110" },
    ],
    join: "and",
    action: "call",
    message: "A fall was detected and the heart rate is high.",
  },
  {
    id: "help",
    category: "Safety",
    title: "Call for help",
    description: "Listens for someone asking for help, or for a very loud noise, and calls you straight away.",
    conditions: [
      { sensor: "sound", text: "someone asking for help" },
      { sensor: "sound", text: "a very loud noise" },
    ],
    join: "or",
    action: "call",
    message: "Someone may need help.",
  },
  {
    id: "door",
    category: "Safety",
    title: "Someone at the door",
    description: "Watches every camera you have connected and texts you the moment a person is standing there.",
    conditions: [{ sensor: "camera", text: "a person is standing at the door" }],
    action: "text",
    message: "Someone is at the door.",
  },
  {
    id: "glucose",
    category: "Health",
    title: "Low glucose warning",
    description: "Calls you when your glucose falls below 70 mg/dL, so a low is never missed while you are busy or asleep.",
    conditions: [{ sensor: "glucose", text: "drops below 70" }],
    action: "call",
    message: "Your glucose is low.",
  },
  {
    id: "low-still",
    category: "Health",
    title: "Low and not moving",
    description: "Calls when glucose is low and the device has not moved for a while, which is when a low is dangerous.",
    conditions: [
      { sensor: "glucose", text: "is below 70" },
      { sensor: "motion", text: "has been still for more than 60 seconds" },
    ],
    join: "and",
    action: "call",
    message: "Glucose is low and there has been no movement.",
  },
  {
    id: "heart",
    category: "Health",
    title: "Heart rate spike",
    description: "Texts you to slow down when your heart rate climbs past 150 beats a minute.",
    conditions: [{ sensor: "heart", text: "goes above 150" }],
    action: "text",
    message: "Your heart rate is above 150. Slow down.",
  },
  {
    id: "package",
    category: "Home",
    title: "Package delivered",
    description: "Texts you when a parcel appears on the doorstep, so it does not sit outside.",
    conditions: [{ sensor: "camera", text: "a package is on the doorstep" }],
    action: "text",
    message: "A package arrived.",
  },
  {
    id: "couch",
    category: "Home",
    title: "Dog on the couch",
    description: "Phones you the moment the dog climbs onto the couch, wherever you are.",
    conditions: [{ sensor: "camera", text: "a dog is on the couch" }],
    action: "call",
    message: "The dog is on the couch.",
  },
  {
    id: "hand",
    category: "Work",
    title: "Hand raised",
    description: "Texts you when someone in view raises a hand, for questions in a class or a talk.",
    conditions: [{ sensor: "camera", text: "someone raises their hand" }],
    action: "text",
    message: "Someone has a question.",
  },
  {
    id: "left",
    category: "Work",
    title: "Left the site",
    description: "Texts you when the device goes more than 200 metres from where it started.",
    conditions: [{ sensor: "location", text: "is more than 200 m from where I started" }],
    action: "text",
    message: "The device has left the site.",
  },
  {
    id: "keyword",
    category: "Work",
    title: "Keyword in a meeting",
    description: "Texts you whenever someone mentions the budget out loud.",
    conditions: [{ sensor: "sound", text: "someone mentioning the budget" }],
    action: "text",
    message: "The budget came up.",
  },
];
