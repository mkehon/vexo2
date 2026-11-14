export type Output =
  | { kind: "speak"; message: string }
  /** A phone call in which a voice says the message, or a text message carrying it. */
  | { kind: "call"; to: string; message: string }
  | { kind: "text"; to: string; message: string }
  | {
      kind: "webhook";
      url: string;
      /** The app it was set up for (an id from lib/catalog.ts), when one was chosen. */
      app?: string;
    };

/** The kinds of sensor a rule can watch. */
export type SensorKind = "camera" | "sound" | "location" | "heart" | "glucose" | "motion";

/** One thing an automation checks: a sensor, and a yes/no question about what it reads. */
export type Condition = {
  sensor: SensorKind;
  /**
   * The devices it is checked on (ids from lib/catalog.ts); it holds when it holds on any of them.
   * Missing or empty means every device connected for that sensor.
   */
  devices?: string[];
  /** The condition as a phrase that reads after "When", such as "the heart rate goes above 120". */
  when: string;
  question: string;
  yes: string;
  no: string;
  compiled: boolean;
  note?: string;
};

/**
 * An automation. Its first condition is written on the rule itself (`sensor`, `when`,
 * `question` and so on); any others are in `more`. Use `conditionsOf` to read them all.
 */
export type Rule = {
  id: string;
  /** The sensor this rule watches. Missing on rules saved before other sensors existed; those watch the camera. */
  sensor?: SensorKind;
  /** The devices the first condition is checked on. See `Condition.devices`. */
  devices?: string[];
  /** What the user typed after "IF". */
  when: string;
  /** The yes/no question the detector answers about a single frame or reading. */
  question: string;
  /** What the frame or reading shows when the answer is yes / no. Empty when not compiled. */
  yes: string;
  no: string;
  /** False when the question is just the user's sentence, because it could not be sharpened. */
  compiled: boolean;
  /** Why the rule was not sharpened, when it wasn't. */
  note?: string;
  /** Further conditions, joined to the first by `join`. */
  more?: Condition[];
  /** Whether every condition must hold or any one of them. Only matters when there are several. */
  join?: "and" | "or";
  /** What its sensors showed when it was switched off. Shown in place of the live feed until it is switched back on. */
  paused?: { thumbnail: string; detail: string };
  output: Output;
  enabled: boolean;
};

/** The parts of a rule the detector needs. */
export type WatchQuestion = Pick<Rule, "id" | "question" | "yes" | "no">;

export type CompiledRule = {
  question: string;
  yes: string;
  no: string;
  /** Short sentence to announce when the rule fires. */
  say: string;
  compiled: boolean;
  /** Why the rule was not compiled, when it wasn't. */
  note?: string;
};

/** The AI providers that can sharpen a rule. */
export type Provider = "openai" | "anthropic" | "gemini";

/** The keys the app can hold: the detector's, one per provider, and the ones that reach a phone. */
export type KeyName = "typesafe" | Provider | "elevenlabs" | "twilioSid" | "twilioToken";

export type KeyStatus = {
  /** Saved from the app's Settings, set in the environment, or missing. */
  source: "app" | "env" | "none";
  /** Last four characters of the key. Empty when there is no key or the viewer may not see it. */
  hint: string;
};

export type Settings = {
  /** Settings can be changed only from the computer running vexo. */
  canEdit: boolean;
  /** The provider that sharpens rules. */
  provider: Provider;
  keys: Record<KeyName, KeyStatus>;
  reach: ReachStatus;
};

/** Whether automations can phone or text someone, and from which number. */
export type ReachStatus = {
  /** The number calls and texts come from, such as "+14432251356". Empty when none is chosen. */
  number: string;
  /** True when everything a call needs is saved: an ElevenLabs key and a number. */
  call: boolean;
  /** True when everything a text needs is saved: the Twilio credentials and a number. */
  text: boolean;
};

/** A phone number in the ElevenLabs account that calls can be placed from. */
export type PhoneNumber = { id: string; number: string; label: string };

/** A whole automation worked out from one sentence: the sensor, the check and the action. */
export type ComposedRule = CompiledRule & {
  sensor: SensorKind;
  /** The condition as a phrase that reads after "When". */
  when: string;
  action: Output["kind"];
  /** For "speak", "call" and "text": the sentence to say or send. */
  message: string;
  /** For "webhook": the service the person named, such as "Slack". May be empty. */
  destination: string;
  /** For "webhook": the address, when the person typed one. May be empty. */
  url: string;
};

export type FiredEvent = {
  id: string;
  ruleId: string;
  when: string;
  at: number;
  probability: number;
  sensor: SensorKind;
  /** Small JPEG data URL of the frame that fired the rule. Empty for sensors other than the camera. */
  thumbnail: string;
  /** The reading that fired the rule, in a few words. Empty for the camera. */
  detail: string;
  result: string;
  /** The question the detector answered. */
  question?: string;
  /** How long the detector took on the check that fired the rule. */
  detectorMs?: number;
  /** How long the action took to run. */
  actionMs?: number;
};
