"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { useGlucoseSensor } from "@/lib/sensor-hooks/useGlucoseSensor";
import type { useHeartSensor } from "@/lib/sensor-hooks/useHeartSensor";
import type { useLocationSensor } from "@/lib/sensor-hooks/useLocationSensor";
import type { MotionPreset, useMotionSensor } from "@/lib/sensor-hooks/useMotionSensor";
import type { useSoundSensor } from "@/lib/sensor-hooks/useSoundSensor";
import { SENSOR_ORDER, SENSORS } from "@/lib/sensors";
import type { SensorKind } from "@/lib/types";
import {
  BluetoothIcon,
  ConnectorTile,
  DeviceIcon,
  DropletIcon,
  focusRing,
  HeartIcon,
  MicIcon,
  MotionIcon,
  PinIcon,
  secondaryButton,
  SensorIcon,
  SlidersIcon,
} from "./ui";

/* ---------- Choosing a sensor ---------- */

export function SensorTabs(props: {
  value: SensorKind;
  onChange: (sensor: SensorKind) => void;
  connected: Record<SensorKind, boolean>;
}) {
  const { value, onChange, connected } = props;
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sensor">
      {SENSOR_ORDER.map((kind) => {
        const selected = kind === value;
        return (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(kind)}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${focusRing} ${
              selected ? "border-brand bg-brand text-on-brand" : "border-line text-muted hover:text-foreground"
            }`}
          >
            <SensorIcon sensor={kind} size={16} />
            {SENSORS[kind].label}
            {connected[kind] && (
              <span
                className={`h-2 w-2 rounded-full ${selected ? "bg-on-brand" : "bg-hit"}`}
                role="img"
                aria-label="connected"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Pieces shared by the panels ---------- */

/** The dark box that shows what a sensor is reading, sized like the camera picture. */
function Feed(props: { live: boolean; simulated?: boolean; icon: ReactNode; hint: string; children: ReactNode }) {
  const { live, simulated, icon, hint, children } = props;
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-black text-white">
      {live ? (
        <>
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
            {simulated ? "Simulated" : "Live"}
          </span>
          {children}
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 px-6 text-center text-white/60">
          {icon}
          <p className="text-sm">{hint}</p>
        </div>
      )}
    </div>
  );
}

function Connected({ label, onDisconnect }: { label: string; onDisconnect: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="min-w-0 truncate text-sm text-muted">
        Connected: <span className="font-medium text-foreground">{label}</span>
      </p>
      <button type="button" className={`${secondaryButton} shrink-0`} onClick={onDisconnect}>
        Disconnect
      </button>
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-sm text-danger">
      {children}
    </p>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${focusRing} ${
        active ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-background"
      }`}
    >
      {children}
    </button>
  );
}

const slider = "h-2 w-full cursor-pointer accent-(--brand)";

/* ---------- Sound ---------- */

export function SoundPanel({ sound }: { sound: ReturnType<typeof useSoundSensor> }) {
  const { reading, source } = sound;
  // The meter runs from -70 dB (silence in practice) to 0 dB (the loudest the microphone records).
  const fill = (db: number) => `${Math.min(100, Math.max(0, ((db + 70) / 70) * 100))}%`;

  return (
    <>
      <Feed live={sound.connected} icon={<MicIcon size={28} />} hint="Pick a microphone below to start listening">
        {reading && (
          <div className="flex w-full flex-col gap-4 px-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-3xl font-bold capitalize">{reading.loudness}</p>
              <p className="tabular-nums text-white/60">{reading.loudness_db} dB</p>
            </div>
            <div className="relative h-2.5 rounded-full bg-white/15" aria-hidden>
              <div className="h-full rounded-full bg-white transition-[width] duration-150" style={{ width: fill(reading.loudness_db) }} />
              <span className="absolute -top-1 h-4.5 w-0.5 bg-red-400" style={{ left: fill(reading.peak_db_last_3_seconds) }} />
            </div>
            <p className="line-clamp-2 min-h-10 text-sm text-white/75">
              {reading.heard_in_last_15_seconds ? `“${reading.heard_in_last_15_seconds}”` : "No words heard in the last 15 seconds"}
            </p>
          </div>
        )}
      </Feed>

      <div className="grid gap-2 sm:grid-cols-3">
        <ConnectorTile
          icon={<MicIcon />}
          title="Microphone"
          detail="This device, a headset or earbuds"
          active={sound.connected}
          onClick={() => void sound.connect()}
        />
      </div>

      {source && sound.microphones.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Microphone
          <select
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-foreground"
            value={source.deviceId ?? ""}
            onChange={(event) => void sound.connect(event.target.value)}
          >
            {sound.microphones.map((microphone) => (
              <option key={microphone.deviceId} value={microphone.deviceId}>
                {microphone.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>
      )}

      {source && <Connected label={source.label} onDisconnect={sound.disconnect} />}
      {source && sound.speechNote && <p className="text-sm text-muted">Loudness only for now. {sound.speechNote}</p>}
      {sound.error && <Problem>{sound.error}</Problem>}
    </>
  );
}

/* ---------- Location ---------- */

const SPEEDS = [
  ["Standing", 0],
  ["Walking", 5],
  ["Cycling", 18],
  ["Driving", 50],
] as const;

export function LocationPanel({ location }: { location: ReturnType<typeof useLocationSensor> }) {
  const { reading, source } = location;
  const [distance, setDistance] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [placeName, setPlaceName] = useState("");

  const move = (nextDistance: number, nextSpeed: number) => {
    setDistance(nextDistance);
    setSpeed(nextSpeed);
    location.simulate(nextDistance, nextSpeed);
  };

  const savePlace = (event: FormEvent) => {
    event.preventDefault();
    const name = placeName.trim();
    if (name && location.savePlace(name)) setPlaceName("");
  };

  return (
    <>
      <Feed
        live={location.connected}
        simulated={source === "simulator"}
        icon={<PinIcon size={28} />}
        hint="Pick a location source below to start tracking"
      >
        {reading && (
          <div className="flex w-full flex-col gap-2 px-6">
            <p className="text-3xl font-bold tabular-nums">
              {reading.distance_from_start_m} m <span className="text-base font-medium text-white/60">from start</span>
            </p>
            <p className="tabular-nums text-white/75">
              {reading.moving ? `Moving at ${reading.speed_kmh} km/h` : `Stationary for ${reading.seconds_stationary} s`}
            </p>
            <p className="text-sm text-white/75">
              {reading.currently_at.length > 0 ? `At ${reading.currently_at.join(", ")}` : "Not at a saved place"}
            </p>
            <p className="text-xs tabular-nums text-white/50">
              {reading.latitude}, {reading.longitude} · accurate to {reading.accuracy_m} m
            </p>
          </div>
        )}
      </Feed>

      <div className="grid gap-2 sm:grid-cols-3">
        <ConnectorTile
          icon={<PinIcon />}
          title="This device"
          detail="GPS from this phone or computer"
          active={source === "gps"}
          onClick={location.connectGps}
        />
        <ConnectorTile
          icon={<SlidersIcon />}
          title="Simulator"
          detail="Move a pretend device around"
          active={source === "simulator"}
          onClick={() => {
            setDistance(0);
            setSpeed(0);
            location.connectSimulator();
          }}
        />
      </div>

      {source === "simulator" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="flex justify-between text-muted">
              Distance from start <span className="tabular-nums text-foreground">{distance} m</span>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={10}
              value={distance}
              onChange={(event) => move(Number(event.target.value), speed)}
              className={slider}
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Speed">
            {SPEEDS.map(([label, value]) => (
              <Chip key={label} active={speed === value} onClick={() => move(distance, value)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {source && (
        <form onSubmit={savePlace} className="flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
              value={placeName}
              onChange={(event) => setPlaceName(event.target.value)}
              placeholder="Name this spot, such as Home"
              aria-label="Name for the current spot"
            />
            <button type="submit" className={secondaryButton} disabled={!placeName.trim()}>
              Save place
            </button>
          </div>
          {location.places.length > 0 && (
            <ul className="flex flex-wrap gap-2 text-sm">
              {location.places.map((place) => (
                <li key={place.name} className="flex items-center gap-1 rounded-full border border-line py-1 pl-3 pr-1">
                  {place.name}
                  <button
                    type="button"
                    onClick={() => location.removePlace(place.name)}
                    className={`rounded-full px-1.5 text-muted hover:text-danger ${focusRing}`}
                    aria-label={`Remove the place ${place.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}

      {source && (
        <Connected label={source === "gps" ? "This device's location" : source === "remote" ? "Another device's location" : "Simulator"} onDisconnect={location.disconnect} />
      )}
      {location.error && <Problem>{location.error}</Problem>}
    </>
  );
}

/* ---------- Heart rate ---------- */

const HEART_PRESETS = [
  ["Resting", 62],
  ["Walking", 95],
  ["Running", 150],
  ["Sprinting", 180],
] as const;

export function HeartPanel({ heart }: { heart: ReturnType<typeof useHeartSensor> }) {
  const { reading, source } = heart;
  const [bpm, setBpm] = useState(72);
  const set = (next: number) => {
    setBpm(next);
    heart.simulate(next);
  };

  return (
    <>
      <Feed
        live={heart.connected}
        simulated={source?.kind === "simulator"}
        icon={<HeartIcon size={28} />}
        hint="Pick a heart-rate source below to start reading"
      >
        {reading && (
          <div className="flex flex-col items-center gap-2">
            <p className="flex items-center gap-3 text-5xl font-bold tabular-nums">
              <span className="animate-pulse text-red-500">
                <HeartIcon size={36} />
              </span>
              {reading.heart_rate_bpm}
              <span className="text-base font-medium text-white/60">bpm</span>
            </p>
            <p className="text-sm tabular-nums text-white/70">
              Average {reading.average_bpm_last_minute} · range {reading.lowest_bpm_last_5_minutes}–
              {reading.highest_bpm_last_5_minutes}
            </p>
          </div>
        )}
      </Feed>

      <div className="grid gap-2 sm:grid-cols-3">
        {heart.canUseBluetooth && (
          <ConnectorTile
            icon={<BluetoothIcon />}
            title="Bluetooth"
            detail="A chest strap or band that broadcasts"
            active={source?.kind === "bluetooth"}
            onClick={() => void heart.connectBluetooth()}
          />
        )}
        <ConnectorTile
          icon={<SlidersIcon />}
          title="Simulator"
          detail="Set a pretend heart rate"
          active={source?.kind === "simulator"}
          onClick={() => {
            setBpm(72);
            heart.connectSimulator();
          }}
        />
      </div>

      {source?.kind === "simulator" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="flex justify-between text-muted">
              Heart rate <span className="tabular-nums text-foreground">{bpm} bpm</span>
            </span>
            <input
              type="range"
              min={40}
              max={200}
              value={bpm}
              onChange={(event) => set(Number(event.target.value))}
              className={slider}
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
            {HEART_PRESETS.map(([label, value]) => (
              <Chip key={label} active={bpm === value} onClick={() => set(value)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {source && <Connected label={source.label} onDisconnect={heart.disconnect} />}
      {heart.error && <Problem>{heart.error}</Problem>}
    </>
  );
}

/* ---------- Glucose ---------- */

const NIGHTSCOUT_KEY = "vexo.nightscout";

const GLUCOSE_PRESETS = [
  ["Low", 62],
  ["Normal", 104],
  ["After a meal", 165],
  ["High", 240],
] as const;

export function GlucosePanel({ glucose }: { glucose: ReturnType<typeof useGlucoseSensor> }) {
  const { reading, source } = glucose;
  const [level, setLevel] = useState(104);
  const [showSite, setShowSite] = useState(false);
  const [site, setSite] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  // The site address is remembered; the access token is not.
  useEffect(() => {
    try {
      setSite(localStorage.getItem(NIGHTSCOUT_KEY) ?? "");
    } catch {
      // Storage is unavailable: the address has to be typed each time.
    }
  }, []);

  const set = (next: number) => {
    setLevel(next);
    glucose.simulate(next);
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await glucose.connectNightscout(site.trim(), token);
    try {
      localStorage.setItem(NIGHTSCOUT_KEY, site.trim());
    } catch {
      // Storage is unavailable: nothing to remember.
    }
    setBusy(false);
  };

  return (
    <>
      <Feed
        live={glucose.connected}
        simulated={source?.kind === "simulator"}
        icon={<DropletIcon size={28} />}
        hint="Pick a glucose source below to start reading"
      >
        {reading && (
          <div className="flex flex-col items-center gap-2">
            <p className="flex items-baseline gap-3 text-5xl font-bold tabular-nums">
              {reading.glucose_mg_dl}
              <span className="text-base font-medium text-white/60">mg/dL</span>
            </p>
            <p className="text-sm capitalize tabular-nums text-white/75">
              {reading.range} · {reading.trend}
            </p>
            <p className="text-xs tabular-nums text-white/50">
              {reading.glucose_mmol_l} mmol/L · read {reading.minutes_since_reading} min ago
            </p>
          </div>
        )}
      </Feed>

      <div className="grid gap-2 sm:grid-cols-3">
        <ConnectorTile
          icon={<DropletIcon />}
          title="Nightscout"
          detail="A Dexcom or Libre monitor's feed"
          active={source?.kind === "nightscout" || (showSite && !source)}
          onClick={() => setShowSite(true)}
        />
        <ConnectorTile
          icon={<SlidersIcon />}
          title="Simulator"
          detail="Set a pretend glucose level"
          active={source?.kind === "simulator"}
          onClick={() => {
            setShowSite(false);
            setLevel(104);
            glucose.connectSimulator();
          }}
        />
      </div>

      {showSite && source?.kind !== "nightscout" && (
        <form onSubmit={connect} className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <input
            className="rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
            value={site}
            onChange={(event) => setSite(event.target.value)}
            placeholder="https://your-site.example.com"
            aria-label="Nightscout site address"
            inputMode="url"
          />
          <div className="flex gap-2">
            <input
              type="password"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none placeholder:text-muted focus:border-brand"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Access token, if the site needs one"
              aria-label="Nightscout access token"
            />
            <button type="submit" className={secondaryButton} disabled={busy || !site.trim()}>
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      )}

      {source?.kind === "simulator" && (
        <div className="flex flex-col gap-3 rounded-xl border border-line p-3">
          <label className="flex flex-col gap-2 text-sm">
            <span className="flex justify-between text-muted">
              Glucose <span className="tabular-nums text-foreground">{level} mg/dL</span>
            </span>
            <input
              type="range"
              min={40}
              max={400}
              value={level}
              onChange={(event) => set(Number(event.target.value))}
              className={slider}
            />
          </label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Presets">
            {GLUCOSE_PRESETS.map(([label, value]) => (
              <Chip key={label} active={level === value} onClick={() => set(value)}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      {source && <Connected label={source.label} onDisconnect={glucose.disconnect} />}
      {glucose.error && <Problem>{glucose.error}</Problem>}
    </>
  );
}

/* ---------- Motion ---------- */

const MOTION_PRESETS: [string, MotionPreset][] = [
  ["Still", "still"],
  ["Walk", "walking"],
  ["Shake", "shaking"],
  ["Drop", "dropped"],
  ["Face down", "face down"],
  ["Face up", "face up"],
];

export function MotionPanel({ motion }: { motion: ReturnType<typeof useMotionSensor> }) {
  const { reading, source } = motion;

  return (
    <>
      <Feed
        live={motion.connected}
        simulated={source === "simulator"}
        icon={<MotionIcon size={28} />}
        hint="Pick a motion source below to start reading"
      >
        {reading && (
          <div className="flex w-full flex-col gap-2 px-6">
            <p className="text-3xl font-bold capitalize">{reading.movement}</p>
            <p className="capitalize text-white/75">{reading.orientation}</p>
            <p className="text-sm tabular-nums text-white/60">
              Peak {reading.peak_acceleration_g_last_second.toFixed(1)} g · still for {reading.seconds_still} s
            </p>
            {(reading.free_fall_in_last_3_seconds || reading.impact_in_last_3_seconds) && (
              <p className="flex gap-2 text-xs font-semibold">
                {reading.free_fall_in_last_3_seconds && <span className="rounded-full bg-red-500 px-2 py-0.5">Free fall</span>}
                {reading.impact_in_last_3_seconds && <span className="rounded-full bg-red-500 px-2 py-0.5">Impact</span>}
              </p>
            )}
          </div>
        )}
      </Feed>

      <div className="grid gap-2 sm:grid-cols-3">
        <ConnectorTile
          icon={<DeviceIcon />}
          title="This device"
          detail="A phone's motion sensors"
          active={source === "device"}
          onClick={() => void motion.connectDevice()}
        />
        <ConnectorTile
          icon={<SlidersIcon />}
          title="Simulator"
          detail="Move a pretend device"
          active={source === "simulator"}
          onClick={motion.connectSimulator}
        />
      </div>

      {source === "simulator" && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-line p-3" role="group" aria-label="Movements">
          {MOTION_PRESETS.map(([label, preset]) => (
            <Chip key={preset} onClick={() => motion.simulate(preset)}>
              {label}
            </Chip>
          ))}
        </div>
      )}

      {source && (
        <Connected label={source === "device" ? "This device's motion sensors" : source === "remote" ? "Another device's motion sensors" : "Simulator"} onDisconnect={motion.disconnect} />
      )}
      {motion.error && <Problem>{motion.error}</Problem>}
    </>
  );
}
