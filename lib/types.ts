export type Output =
  | { kind: "speak"; message: string }
  | { kind: "webhook"; url: string };

export type Rule = {
  id: string;
  /** What the user typed after "IF". */
  when: string;
  /** The yes/no question the detector answers about a single frame. */
  question: string;
  /** What the frame shows when the answer is yes / no. Empty when not compiled. */
  yes: string;
  no: string;
  /** False when the question is just the user's sentence, because it could not be sharpened. */
  compiled: boolean;
  /** Why the rule was not sharpened, when it wasn't. */
  note?: string;
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

export type KeyName = "typesafe" | Provider;

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
};

export type FiredEvent = {
  id: string;
  ruleId: string;
  when: string;
  at: number;
  probability: number;
  /** Small JPEG data URL of the frame that fired the rule. */
  thumbnail: string;
  result: string;
};
