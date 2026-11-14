/**
 * Turns a stream of per-frame probabilities into "the condition just became true".
 *
 * A rule fires on the change from no to yes, not on every frame where it is yes.
 * Readings between the two thresholds are treated as unclear and change nothing,
 * which stops a probability hovering near one threshold from firing repeatedly.
 */

/** At or above this, a frame counts as a clear yes. */
export const YES_THRESHOLD = 0.7;
/** At or below this, a frame counts as a clear no. */
export const NO_THRESHOLD = 0.3;
/** Clear readings in a row needed to change state. */
export const CONFIRM_FRAMES = 2;
/** Minimum time between two fires of the same rule. */
export const COOLDOWN_MS = 3000;

export type Trigger = {
  /** Whether the condition currently counts as true. */
  on: boolean;
  yesStreak: number;
  noStreak: number;
  /** Timestamp of the last fire, or 0 if it has never fired. */
  lastFiredAt: number;
};

export function newTrigger(): Trigger {
  return { on: false, yesStreak: 0, noStreak: 0, lastFiredAt: 0 };
}

export function step(
  trigger: Trigger,
  probability: number,
  now: number,
): { next: Trigger; fired: boolean; pending: boolean } {
  let { on, yesStreak, noStreak, lastFiredAt } = trigger;

  if (probability >= YES_THRESHOLD) {
    yesStreak += 1;
    noStreak = 0;
  } else if (probability <= NO_THRESHOLD) {
    noStreak += 1;
    yesStreak = 0;
  }

  let fired = false;
  if (!on && yesStreak >= CONFIRM_FRAMES) {
    on = true;
    if (now - lastFiredAt >= COOLDOWN_MS) {
      fired = true;
      lastFiredAt = now;
    }
  } else if (on && noStreak >= CONFIRM_FRAMES) {
    on = false;
  }

  // This reading pointed towards a change of state that still needs its confirming reading.
  const pending = on ? probability <= NO_THRESHOLD : probability >= YES_THRESHOLD;

  return { next: { on, yesStreak, noStreak, lastFiredAt }, fired, pending };
}
