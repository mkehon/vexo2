"use client";

import { useEffect, useRef, useState } from "react";
import { DEVICE_GROUPS, DEVICES, type Device, type DeviceLink } from "@/lib/catalog";
import { SENSORS } from "@/lib/sensors";
import type { SensorKind } from "@/lib/types";
import { SLOTS, type Studio } from "@/lib/useStudio";
import { SensorIcon } from "../ui";
import { BrandIcon } from "./visuals";

/** Picking devices: the full list behind the Devices button, and the small menu inside the builder. */

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

/** The slot a device is supplying a sense from, or -1. */
export function slotOf(studio: Studio, sense: SensorKind, deviceId: string): number {
  return studio.slots[sense].findIndex((slot) => slot.connected && slot.deviceId === deviceId);
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
 * Every device, as a dense list. Each sense a device has is a small button: click it to
 * connect that sense, click a live one to disconnect it.
 */
export function DeviceGallery(props: {
  studio: Studio;
  open: boolean;
  /** Opens the controls of a source that needs them, such as a simulator's dials. */
  onOpenControls: (sense: SensorKind, slot: number) => void;
  onClose: () => void;
}) {
  const { studio, open, onOpenControls, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  /** The device last touched, whose one-line guide and errors show at the bottom. */
  const [touched, setTouched] = useState<Device | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const press = async (device: Device, link: DeviceLink) => {
    setTouched(device);
    const slot = slotOf(studio, link.sense, device.id);
    if (slot >= 0) return studio.disconnect(link.sense, slot);
    const result = await studio.connect(device, link);
    if (result?.controls) {
      onClose();
      onOpenControls(result.sense, result.slot);
    }
  };

  const error = touched
    ? touched.senses.flatMap((sense) => studio.slots[sense].filter((slot) => slot.deviceId === touched.id && slot.error).map((slot) => slot.error))[0]
    : null;

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the dimmed area around the panel lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="device-gallery-title"
      className="m-auto max-h-[calc(100dvh-3rem)] w-[min(50rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-line bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[calc(100dvh-3rem)] flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line px-4">
          <h2 id="device-gallery-title" className="text-[15px] font-semibold">
            Devices
          </h2>
          <p className="min-w-0 flex-1 truncate text-xs text-muted">Click a sense to connect it. Green is live; click it again to disconnect.</p>
          <button type="button" onClick={onClose} className="h-8 rounded-md border border-line px-3 text-xs font-medium hover:bg-background">
            Done
          </button>
        </div>

        <div className="min-h-0 flex-1 columns-2 gap-x-5 overflow-y-auto px-4 py-3 outline-none">
          {DEVICE_GROUPS.map((group) => (
            <section key={group} className="mb-3 break-inside-avoid">
              <h3 className="mb-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-muted">{group}</h3>
              <ul>
                {DEVICES.filter((device) => device.group === group).map((device) => {
                  const supported = device.links.length > 0;
                  return (
                    <li key={device.id} className={`flex h-8 items-center gap-2 border-b border-line/60 last:border-b-0 ${supported ? "" : "text-muted"}`} title={device.how}>
                      <span className={supported ? "" : "opacity-50"}>
                        <DeviceMark device={device} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {device.name}
                        {device.group !== "Simulators" && <span className="ml-1.5 text-xs font-normal text-muted">{device.maker}</span>}
                      </span>
                      {supported ? (
                        <span className="flex shrink-0 items-center gap-1">
                          {device.links.map((link) => {
                            const live = slotOf(studio, link.sense, device.id) >= 0;
                            return (
                              <button
                                key={link.sense}
                                type="button"
                                onClick={() => void press(device, link)}
                                aria-pressed={live}
                                aria-label={`${device.name}: ${SENSORS[link.sense].label}`}
                                title={live ? `${SENSORS[link.sense].label} is live. Click to disconnect.` : `Connect ${SENSORS[link.sense].label.toLowerCase()} through ${VIA[link.via]}`}
                                className={`flex h-6 w-7 items-center justify-center rounded-[4px] border transition-colors ${
                                  live ? "border-hit bg-hit text-white" : "border-line hover:border-foreground"
                                }`}
                              >
                                <SensorIcon sensor={link.sense} size={13} />
                              </button>
                            );
                          })}
                        </span>
                      ) : (
                        <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.06em]">Soon</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <p role={error ? "alert" : undefined} className={`shrink-0 border-t border-line px-4 py-2 text-xs ${error ? "text-danger" : "text-muted"}`}>
          {error ?? touched?.how ?? `Several devices can supply the same sense at once: up to ${SLOTS.camera} cameras and ${SLOTS.sound} of each other sense.`}
        </p>
      </div>
    </dialog>
  );
}

/**
 * A small menu of the devices that can supply one sense. Choosing one connects it, or
 * connects it again if it is already live.
 */
export function DeviceMenu(props: {
  studio: Studio;
  sense: SensorKind;
  /** Stands out when the sense has no device yet. */
  urgent: boolean;
  onPicked: (device: Device, result: { slot: number; controls: boolean }) => void;
}) {
  const { studio, sense, urgent, onPicked } = props;
  const [open, setOpen] = useState(false);
  const options = DEVICES.flatMap((device) => {
    const link = device.links.find((item) => item.sense === sense);
    return link ? [{ device, link }] : [];
  });

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
          <ul role="menu" className="absolute left-0 top-8 z-40 max-h-72 w-64 overflow-y-auto rounded-md border border-line bg-card py-1 shadow-xl">
            {options.map(({ device, link }) => {
              const live = slotOf(studio, sense, device.id) >= 0;
              return (
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
                      <span className="block truncate text-[11px] text-muted">through {VIA[link.via]}</span>
                    </span>
                    {live && <span className="shrink-0 rounded-[3px] bg-hit px-1 py-0.5 font-mono text-[9px] font-semibold uppercase text-white">Live</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </span>
  );
}
