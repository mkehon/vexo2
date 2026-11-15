/**
 * The relay: how a phone's sensors reach the computer. The phone opens /phone and posts what
 * its sensors read (camera frames as JPEGs, everything else as small JSON readings); the page
 * on the computer picks them up from here. One channel per phone, named after the device it
 * was picked as, so two phones can be connected at once.
 *
 * Everything is held in memory, in this server process only.
 */

import { randomBytes } from "node:crypto";
import { DEVICES } from "./catalog";

export const RELAY_KINDS = ["camera", "sound", "location", "motion"] as const;
export type RelayKind = (typeof RELAY_KINDS)[number];

/** How recently something must have arrived, or been asked for, to count as happening now. */
const FRESH_MS = 4000;

type Entry = { at: number; seq: number; state?: unknown; frame?: Uint8Array };
type Hub = {
  /** The code a phone must present, which it gets from the link the computer shows. New each time the server starts. */
  code: string;
  entries: Map<string, Entry>;
  waiters: Map<string, Set<() => void>>;
  wanted: Map<string, number>;
  /** When each channel's phone was last heard from, sending or just asking what is wanted. */
  heard: Map<string, number>;
};

// Kept on `globalThis` so every route sees the same hub, however the server bundles them.
const store = globalThis as typeof globalThis & { __vexoRelay?: Hub };
const hub: Hub = (store.__vexoRelay ??= { code: "", entries: new Map(), waiters: new Map(), wanted: new Map(), heard: new Map() });
hub.heard ??= new Map();
hub.code ||= randomBytes(9).toString("base64url");

/** The code that goes in the link a phone opens. Whoever has the link may send as that phone; nobody else may. */
export function pairingCode(): string {
  return hub.code;
}

/**
 * True when a request carries the pairing code, in its address or in a header. Checked for
 * everything a phone sends, so knowing this computer's address is not enough to pose as one.
 */
export function isPaired(request: Request): boolean {
  const given = new URL(request.url).searchParams.get("k") ?? request.headers.get("x-vexo-pair") ?? "";
  if (given.length !== hub.code.length) return false;
  // Compares every character, so the time taken does not reveal how much of a guess was right.
  let difference = 0;
  for (let index = 0; index < given.length; index += 1) difference |= given.charCodeAt(index) ^ hub.code.charCodeAt(index);
  return difference === 0;
}

/** Notes that a channel's phone has its page open: it has just sent something or asked what is wanted. */
export function heardFrom(channel: string): void {
  hub.heard.set(channel, Date.now());
}

/** A channel is the id of a device that sends through the relay, so there are only as many as there are such devices. */
export function isChannel(value: unknown): value is string {
  return typeof value === "string" && DEVICES.some((device) => device.remote && device.id === value);
}

export function isRelayKind(value: unknown): value is RelayKind {
  return RELAY_KINDS.includes(value as RelayKind);
}

const keyOf = (channel: string, kind: RelayKind) => `${channel}/${kind}`;

/** Stores what a phone just sent and wakes anyone waiting for it. */
export function put(channel: string, kind: RelayKind, value: { state?: unknown; frame?: Uint8Array }): void {
  const key = keyOf(channel, kind);
  hub.entries.set(key, { ...value, at: Date.now(), seq: (hub.entries.get(key)?.seq ?? 0) + 1 });
  const waiting = hub.waiters.get(key);
  if (waiting) {
    hub.waiters.delete(key);
    for (const wake of waiting) wake();
  }
}

/** The latest thing a phone sent of one kind, if it is recent. Asking marks the kind as wanted. */
export function latest(channel: string, kind: RelayKind): Entry | null {
  hub.wanted.set(keyOf(channel, kind), Date.now());
  const entry = hub.entries.get(keyOf(channel, kind));
  return entry && Date.now() - entry.at < FRESH_MS ? entry : null;
}

/** The next camera frame after `after`, waiting up to `ms` for one to arrive. */
export async function nextFrame(channel: string, after: number, ms: number): Promise<Entry | null> {
  const key = keyOf(channel, "camera");
  const ready = () => {
    const entry = latest(channel, "camera");
    return entry && entry.seq > after ? entry : null;
  };
  const now = ready();
  if (now) return now;
  await new Promise<void>((resolve) => {
    const waiting = hub.waiters.get(key) ?? new Set<() => void>();
    hub.waiters.set(key, waiting);
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiting.delete(wake);
      resolve();
    }, ms);
    waiting.add(wake);
  });
  return ready();
}

/** What a channel is doing: whether its phone has the page open, the kinds it is sending, and the kinds the computer is asking for. */
export function statusOf(channel: string): { phone: boolean; live: RelayKind[]; wanted: RelayKind[] } {
  const now = Date.now();
  return {
    phone: now - (hub.heard.get(channel) ?? 0) < FRESH_MS,
    live: RELAY_KINDS.filter((kind) => now - (hub.entries.get(keyOf(channel, kind))?.at ?? 0) < FRESH_MS),
    wanted: RELAY_KINDS.filter((kind) => now - (hub.wanted.get(keyOf(channel, kind)) ?? 0) < FRESH_MS),
  };
}
