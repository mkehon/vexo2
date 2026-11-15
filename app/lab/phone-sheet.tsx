"use client";

import { useEffect, useRef, useState } from "react";
import type { Device } from "@/lib/catalog";
import { SENSORS } from "@/lib/sensors";
import type { SensorKind } from "@/lib/types";
import { SensorIcon } from "../ui";

/**
 * Pairing a phone: a code to scan, which opens the page on the phone that sends its sensors
 * here, and a live line for each sense so it is clear when they start arriving.
 */
export function PhoneSheet({ device, onClose }: { device: Device | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [link, setLink] = useState<{ url: string | null; qr: string | null; via: "tunnel" | "wifi" | null; error?: string } | null>(null);
  const [live, setLive] = useState<string[]>([]);
  /** Whether the phone has the page open, and how long this sheet has been waiting for it. */
  const [phone, setPhone] = useState(false);
  const [waited, setWaited] = useState(0);
  const id = device?.id;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (device && !element.open) element.showModal();
    if (!device && element.open) element.close();
  }, [device]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const opened = Date.now();
    setLink(null);
    setLive([]);
    setPhone(false);
    setWaited(0);
    // The link is asked for again and again, because it changes when the public tunnel starts or stops.
    const getLink = () =>
      fetch(`/api/relay/link?channel=${id}`)
        .then((response) => response.json())
        .then((body) => {
          if (cancelled) return;
          setLink((previous) => (previous?.url === (body.url ?? null) && previous?.error === body.error ? previous : { url: body.url ?? null, qr: body.qr ?? null, via: body.via ?? null, error: body.error }));
        })
        .catch(() => !cancelled && setLink((previous) => previous ?? { url: null, qr: null, via: null }));
    const ask = () =>
      fetch(`/api/relay?channel=${id}`)
        .then((response) => response.json())
        .then((body: { live?: string[]; phone?: boolean }) => {
          if (cancelled) return;
          setLive(body.live ?? []);
          setPhone(body.phone === true);
          setWaited(Math.round((Date.now() - opened) / 1000));
        })
        .catch(() => {});
    void getLink();
    void ask();
    const timers = [setInterval(() => void ask(), 1000), setInterval(() => void getLink(), 3000)];
    return () => {
      cancelled = true;
      timers.forEach(clearInterval);
    };
  }, [id]);

  const tunnelled = link?.via === "tunnel";

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the dimmed area around the panel lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="phone-sheet-title"
      className="m-auto w-[min(27rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/55"
    >
      {device && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-4">
            <h2 id="phone-sheet-title" className="text-[15px] font-semibold">
              Connect your {device.name}
            </h2>
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-line px-3 text-xs font-medium hover:bg-background">
              Done
            </button>
          </div>

          {link === null ? (
            <p className="py-10 text-center text-sm text-muted">Getting the link…</p>
          ) : link.url && link.qr ? (
            <div className="flex gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- a QR code drawn by this app's own server */}
              <img src={`data:image/svg+xml;utf8,${encodeURIComponent(link.qr)}`} alt="QR code for the phone link" className="h-40 w-40 shrink-0 rounded-md border border-line" />
              <ol className="flex list-decimal flex-col gap-2 pl-4 text-[13px] leading-snug">
                {tunnelled ? (
                  <>
                    <li>Scan the code with the phone&rsquo;s camera and open the link. It works on any network, mobile data included.</li>
                    <li>Turn on the senses to share. They show up here within a second.</li>
                  </>
                ) : (
                  <>
                    <li>Put the phone on the same Wi-Fi as this computer and scan the code with its camera.</li>
                    <li>The phone warns that the connection is not private, because the certificate is this computer&rsquo;s own. Choose to continue.</li>
                    <li>Turn on the senses to share. They show up here within a second.</li>
                  </>
                )}
              </ol>
            </div>
          ) : (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {link.error ?? "This computer is not on a network, so a phone cannot reach it. Connect it to Wi-Fi and open this again."}
            </p>
          )}
          {link?.url && <p className="select-all break-all rounded-md bg-background px-2.5 py-1.5 font-mono text-[11px] text-muted">{link.url}</p>}

          {link?.url && (
            <p className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-[13px] font-medium ${phone ? "border-hit bg-hit-soft" : "border-line"}`} role="status">
              <span className={`h-2 w-2 shrink-0 rounded-full ${phone ? "bg-hit" : "animate-pulse bg-muted/60"}`} aria-hidden />
              {phone ? "The phone has the page open." : "No phone has reached this computer yet."}
            </p>
          )}
          {link?.url && !phone && !tunnelled && waited >= 12 && (
            <p className="rounded-md bg-[var(--fire-soft,#FFF3EA)] px-2.5 py-2 text-xs leading-relaxed text-[var(--fire-ink,#B93A0A)]">
              If the page will not load on the phone, this Wi-Fi is probably keeping devices apart, which office and event networks often do. Run{" "}
              <code className="rounded bg-white/70 px-1 font-mono">npm run tunnel</code> in the project folder: this code then changes to a link that works from any network, with no
              certificate warning.
            </p>
          )}

          <ul className="grid grid-cols-2 gap-1.5">
            {device.links.map(({ sense }) => {
              const on = live.includes(sense);
              return (
                <li key={sense} className={`flex h-9 items-center gap-2 rounded-md border px-2.5 text-[13px] font-medium ${on ? "border-hit bg-hit-soft" : "border-line text-muted"}`}>
                  <SensorIcon sensor={sense as SensorKind} size={14} />
                  {SENSORS[sense].label}
                  <span className={`ml-auto font-mono text-[10px] uppercase ${on ? "font-semibold text-hit" : ""}`}>{on ? "Live" : "Waiting"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </dialog>
  );
}
