"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HeartState } from "../sensors";

/** How long beats are kept, to report the range over the last five minutes. */
const HISTORY_MS = 5 * 60_000;

/** The parts of Web Bluetooth used here; TypeScript's standard library does not include it. */
type Characteristic = {
  startNotifications(): Promise<unknown>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
};
type HeartRateDevice = {
  name?: string;
  gatt?: {
    connect(): Promise<{
      getPrimaryService(name: string): Promise<{ getCharacteristic(name: string): Promise<Characteristic> }>;
    }>;
    disconnect(): void;
  };
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
};
type Bluetooth = { requestDevice(options: { filters: { services: string[] }[] }): Promise<HeartRateDevice> };

function bluetooth(): Bluetooth | undefined {
  return (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
}

/**
 * Reads a heart rate from a Bluetooth strap or band that broadcasts the standard heart-rate
 * service, or from a simulator. A reading holds the current rate and how it has moved lately.
 */
export function useHeartSensor() {
  const [source, setSource] = useState<{ kind: "bluetooth" | "simulator"; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<HeartState | null>(null);
  // Browsers without Web Bluetooth (Safari, Firefox, every iPhone browser) can only use the simulator.
  const [canUseBluetooth, setCanUseBluetooth] = useState(true);
  useEffect(() => {
    setCanUseBluetooth(bluetooth() !== undefined);
  }, []);

  const stateRef = useRef<HeartState | null>(null);
  const beats = useRef<{ at: number; bpm: number }[]>([]);
  const stopRef = useRef<(() => void) | null>(null);

  const record = useCallback((bpm: number) => {
    const now = Date.now();
    const history = beats.current;
    history.push({ at: now, bpm });
    while (history[0].at < now - HISTORY_MS) history.shift();

    const lastMinute = history.filter((beat) => beat.at >= now - 60_000);
    // The beat nearest to thirty seconds ago, or the oldest one while there is less history than that.
    const before = history.find((beat) => beat.at >= now - 30_000) ?? history[0];
    const all = history.map((beat) => beat.bpm);
    const next: HeartState = {
      heart_rate_bpm: bpm,
      average_bpm_last_minute: Math.round(lastMinute.reduce((total, beat) => total + beat.bpm, 0) / lastMinute.length),
      lowest_bpm_last_5_minutes: Math.min(...all),
      highest_bpm_last_5_minutes: Math.max(...all),
      change_last_30_seconds_bpm: bpm - before.bpm,
    };
    stateRef.current = next;
    setReading(next);
  }, []);

  const disconnect = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    beats.current = [];
    stateRef.current = null;
    setReading(null);
    setSource(null);
  }, []);

  const connectBluetooth = useCallback(async () => {
    const adapter = bluetooth();
    if (!adapter) {
      setError("This browser cannot connect to Bluetooth devices. Use Chrome on a computer or an Android phone.");
      return;
    }
    disconnect();
    try {
      const device = await adapter.requestDevice({ filters: [{ services: ["heart_rate"] }] });
      if (!device.gatt) throw new Error("the device does not accept connections");
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService("heart_rate");
      const measurement = await service.getCharacteristic("heart_rate_measurement");
      measurement.addEventListener("characteristicvaluechanged", (event) => {
        const value = (event.target as unknown as { value?: DataView }).value;
        if (!value) return;
        // The first byte's lowest bit says whether the rate that follows is one byte or two.
        record(value.getUint8(0) & 1 ? value.getUint16(1, true) : value.getUint8(1));
      });
      await measurement.startNotifications();
      device.addEventListener("gattserverdisconnected", () => {
        setError("The heart-rate device disconnected.");
        disconnect();
      });
      stopRef.current = () => device.gatt?.disconnect();
      setSource({ kind: "bluetooth", label: device.name || "Heart-rate device" });
      setError(null);
    } catch (caught) {
      // Closing the browser's device picker without choosing is not an error worth showing.
      const cancelled = caught instanceof DOMException && caught.name === "NotFoundError";
      setError(cancelled ? null : `Could not connect: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }, [disconnect, record]);

  const simulated = useRef(72);

  const connectSimulator = useCallback(() => {
    disconnect();
    simulated.current = 72;
    record(simulated.current);
    // A real monitor reports about once a second.
    const tick = setInterval(() => record(simulated.current), 1000);
    stopRef.current = () => clearInterval(tick);
    setSource({ kind: "simulator", label: "Simulator" });
    setError(null);
  }, [disconnect, record]);

  /** Sets the simulated heart rate; it takes effect on the next beat. */
  const simulate = useCallback(
    (bpm: number) => {
      simulated.current = bpm;
      record(bpm);
    },
    [record],
  );

  // Stops the source when the page goes away. A code reload during development can run this too
  // while keeping the state, so the source is also forgotten: better shown as off than as on and silent.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
      setSource(null);
    },
    [],
  );

  const getState = useCallback(() => stateRef.current, []);

  return {
    connected: source !== null,
    source,
    error,
    reading,
    canUseBluetooth,
    connectBluetooth,
    connectSimulator,
    simulate,
    disconnect,
    getState,
  };
}
