"use client";

import { useState } from "react";
import { baseId, deviceById, DEVICES, sourceLabel, type Device, type DeviceLink } from "@/lib/catalog";
import type { SensorKind } from "@/lib/types";
import type { Studio } from "@/lib/useStudio";
import { SensorIcon } from "../ui";
import { BrandIcon } from "./visuals";

/** Choosing what a condition watches, from a small menu inside the builder. */

const VIA: Record<DeviceLink["via"], string> = {
  camera: "its camera",
  screen: "a shared tab or window",
  file: "a video file",
  microphone: "its microphone",
  gps: "its GPS",
  motion: "its motion sensors",
  bluetooth: "Bluetooth",
  nightscout: "Nightscout",
  simulator: "a simulator",
};

/** The first slot a device is supplying a sense from, or -1. */
export function slotOf(studio: Studio, sense: SensorKind, deviceId: string): number {
  return studio.slots[sense].findIndex((slot) => slot.connected && slot.deviceId !== null && baseId(slot.deviceId) === deviceId);
}

function DeviceMark({ device, sense, size = 20 }: { device: Device; sense?: SensorKind; size?: number }) {
  if (device.icon) return <BrandIcon icon={device.icon} size={size} />;
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[5px] bg-brand-soft" style={{ width: size, height: size }}>
      <SensorIcon sensor={sense ?? device.senses[0]} size={size * 0.6} />
    </span>
  );
}

/**
 * A small menu for choosing what one condition watches. Sources that are already connected come
 * first and are used as they are. Below them, any device can be connected; a shared tab or a
 * video file is added as a source of its own each time, so two streams can run side by side.
 */
export function DeviceMenu(props: {
  studio: Studio;
  sense: SensorKind;
  /** The sources the condition already watches, which are left out of the menu. */
  chosen: string[];
  /** Uses a source that is already connected. */
  onUse: (sourceId: string) => void;
  /** Called once a device chosen here has been connected. */
  onPicked: (device: Device, result: { slot: number; id: string; controls: boolean; pair?: boolean }) => void;
}) {
  const { studio, sense, chosen, onUse, onPicked } = props;
  const [open, setOpen] = useState(false);
  const urgent = chosen.length === 0;
  const connected = studio.slots[sense].flatMap((slot) => (slot.connected && slot.deviceId && !chosen.includes(slot.deviceId) ? [slot.deviceId] : []));
  const options = DEVICES.flatMap((device) => {
    const link = device.links.find((item) => item.sense === sense);
    if (!link) return [];
    const repeatable = link.via === "screen" || link.via === "file";
    const live = slotOf(studio, sense, device.id) >= 0;
    // A device with one sensor of this kind that is already live is offered above, not connected a second time.
    return live && !repeatable ? [] : [{ device, link, another: live && repeatable }];
  });
  const heading = "px-2.5 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-muted";

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold transition-colors ${
          urgent ? "border-foreground bg-foreground text-background" : "border-dashed border-line text-muted hover:border-foreground hover:text-foreground"
        }`}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        {urgent ? "Pick a device" : "or device"}
      </button>
      {open && (
        <>
          {/* Catches a click anywhere else, which closes the menu. */}
          <span className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
          <ul role="menu" className="absolute left-0 top-8 z-40 max-h-80 w-72 overflow-y-auto rounded-md border border-line bg-card pb-1 shadow-xl">
            {connected.length > 0 && (
              <>
                <li role="presentation" className={heading}>
                  Connected now
                </li>
                {connected.map((id) => {
                  const device = deviceById(id);
                  if (!device) return null;
                  return (
                    <li key={id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpen(false);
                          onUse(id);
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-background"
                      >
                        <DeviceMark device={device} sense={sense} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Use {sourceLabel(id)}</span>
                        <span className="shrink-0 rounded-[3px] bg-hit px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-white">Live</span>
                      </button>
                    </li>
                  );
                })}
                <li role="presentation" className={`mt-1 border-t border-line ${heading}`}>
                  Connect another
                </li>
              </>
            )}
            {options.map(({ device, link, another }) => (
              <li key={device.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    const result = await studio.connect(device, link);
                    if (result) onPicked(device, result);
                  }}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-background"
                >
                  <DeviceMark device={device} sense={sense} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{device.group === "Simulators" ? "Simulator" : device.name}</span>
                    <span className="block truncate text-[11px] text-muted">{another ? `another one, through ${VIA[link.via]}` : `through ${VIA[link.via]}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </span>
  );
}
