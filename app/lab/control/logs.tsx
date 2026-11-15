"use client";

import { nameOf } from "@/lib/sensors";
import type { FiredEvent, Rule } from "@/lib/types";
import type { Studio } from "@/lib/useStudio";
import { SensorIcon } from "../../ui";
import { ago } from "../parts";
import { ActionIcon } from "../visuals";
import { label, TAG, type CheckLine } from "./shared";

/* ---------- Logs ---------- */

export function EventLog({ studio, now }: { studio: Studio; now: number }) {
  return (
    <section aria-label="Event log" className="overflow-hidden rounded-md border border-line bg-card">
      <div className={`flex h-9 items-center justify-between border-b border-line px-4 ${label}`}>
        <h2>Event log</h2>
        <span>{studio.events.length === 0 ? "nothing yet" : `${studio.events.length} ${studio.events.length === 1 ? "run" : "runs"}`}</span>
      </div>
      {studio.events.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">Each run is logged here with what the sense read and what was done.</p>
      ) : (
        <ol className="max-h-[26rem] divide-y divide-line overflow-y-auto">
          {studio.events.map((event) => (
            <EventRow key={event.id} event={event} rule={studio.rules.find((rule) => rule.id === event.ruleId)} now={now} />
          ))}
        </ol>
      )}
    </section>
  );
}

function EventRow({ event, rule, now }: { event: FiredEvent; rule?: Rule; now: number }) {
  const pending = event.result.endsWith("…");
  return (
    <li className="flex animate-[lab-enter_0.25s_ease-out] gap-3 px-4 py-3">
      {rule ? (
        <ActionIcon output={rule.output} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft">
          <SensorIcon sensor={event.sensor} size={14} />
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-baseline gap-2 font-mono text-[11px]">
          <span className="tabular-nums text-muted">{new Date(event.at).toLocaleTimeString([], { hour12: false })}</span>
          <span className="font-semibold text-[var(--fire-ink)]">FIRE</span>
          <span className="text-muted">{TAG[event.sensor]}</span>
          <span className="ml-auto text-muted">{ago(event.at, now)}</span>
        </p>
        <p className="text-[13px] font-medium leading-snug">{rule ? nameOf(rule) : event.when}</p>
        {rule?.name && <p className="text-xs leading-snug text-muted">When {event.when}</p>}
        {event.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimize
          <img src={event.thumbnail} alt="The frame that set it off" className="mt-0.5 aspect-video w-40 rounded-[3px] bg-black object-cover" />
        )}
        <p className="font-mono text-[11px] leading-relaxed text-muted">
          {event.detail || "frame"} · {Math.round(event.probability * 100)}%{event.detectorMs !== undefined ? ` in ${event.detectorMs} ms` : ""}
          <span className={pending ? "text-[var(--fire-ink)]" : "text-foreground"}>
            {" → "}
            {event.result}
            {!pending && event.actionMs ? ` (${event.actionMs} ms)` : ""}
          </span>
        </p>
      </div>
    </li>
  );
}

/** Every check as it happens, newest first: the plainest view of the product at work. */
export function CheckStream({ lines }: { lines: CheckLine[] }) {
  return (
    <section aria-label="Checks" className="overflow-hidden rounded-md border border-line bg-card">
      <div className={`flex h-9 items-center justify-between border-b border-line px-4 ${label}`}>
        <h2>Checks, live</h2>
        <span>sense · reading · confidence</span>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">Checks appear here once a device is connected and an automation is armed.</p>
      ) : (
        <ol className="max-h-56 overflow-hidden px-4 py-2 font-mono text-[11px] leading-[1.7]">
          {lines.map((line, index) => (
            <li
              key={line.id}
              className={`grid grid-cols-[4.5rem_2rem_minmax(0,1fr)_2.5rem_2rem] gap-2 tabular-nums ${line.on ? "text-[var(--fire-ink)]" : "text-muted"}`}
              style={{ opacity: Math.max(0.25, 1 - index * 0.07) }}
            >
              <span>{new Date(line.at).toLocaleTimeString([], { hour12: false })}</span>
              <span className="text-foreground">{TAG[line.kind]}</span>
              <span className="truncate">{line.value}</span>
              <span className="text-right">{line.probability === undefined ? "" : line.probability.toFixed(2)}</span>
              <span className="font-semibold">{line.probability === undefined ? "" : line.on ? "YES" : "NO"}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
