/** The browser's side of the relay (see lib/relay.ts): following a phone's readings, and telling a phone from a computer. */

/** True when this page is open on a phone or tablet, whose own sensors are the ones to use. */
export function isPhoneBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  // An iPad reports itself as a Mac; its touch screen gives it away.
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** The pairing code the phone's page was opened with. Sent with everything the page posts. */
let pairing = "";
export function setPairing(code: string): void {
  pairing = code;
}
export function pairingHeaders(): Record<string, string> {
  return pairing ? { "x-vexo-pair": pairing } : {};
}

/** How long a phone may be silent before its last reading stops counting. */
const STALE_MS = 5000;

/**
 * Calls `onState` with each new reading a phone sends of one kind, and with null once the phone
 * has gone quiet, so a reading from a phone that has stopped is not taken for a live one.
 * Returns a function that stops it.
 */
export function followRemote<State>(channel: string, kind: "sound" | "location" | "motion", onState: (state: State | null) => void): () => void {
  let last = 0;
  let heardAt = 0;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch(`/api/relay?channel=${channel}&kind=${kind}`);
      if (response.status === 200) {
        const body = (await response.json()) as { state: State; at: number };
        heardAt = Date.now();
        if (body.at !== last) {
          last = body.at;
          onState(body.state);
        }
      } else if (heardAt && Date.now() - heardAt > STALE_MS) {
        heardAt = 0;
        last = 0;
        onState(null);
      }
    } catch {
      // The server did not answer: try again on the next tick.
    }
    busy = false;
  };
  const timer = setInterval(() => void tick(), 300);
  void tick();
  return () => clearInterval(timer);
}
