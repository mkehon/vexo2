"use client";

import { Fragment, type CSSProperties } from "react";
import { deviceById, sourceName } from "@/lib/catalog";
import { conditionId, conditionsOf, SENSORS } from "@/lib/sensors";
import type { Rule, SensorKind } from "@/lib/types";
import type { Studio } from "@/lib/useStudio";
import { PausedFeed, SensorFeed } from "../feeds";
import { ago, describeAction, Sparkline } from "../parts";
import { ActionIcon } from "../visuals";
import { EMPTY_ART, label, stateOf, TAG, Toggle } from "./shared";

/**
 * The automations, each as a lane beside the live senses it watches.
 */

type Shared = {
  studio: Studio;
  now: number;
  /** Opens a sense's controls when it is connected, or the device picker when it is not. */
  onOpenSense: (kind: SensorKind, slot?: number) => void;
};

/** Everything a lane shows about one automation. */
function view(studio: Studio, rule: Rule) {
  const conditions = conditionsOf(rule);
  const reading = rule.enabled ? studio.readings[rule.id] : undefined;
  // Every device the automation is watching, once each.
  const sources: { kind: SensorKind; slot: number }[] = [];
  const supplied = conditions.map((condition) => {
    const slots = studio.slotsFor(condition);
    for (const slot of slots) {
      if (!sources.some((source) => source.kind === condition.sensor && source.slot === slot)) sources.push({ kind: condition.sensor, slot });
    }
    return slots.length > 0;
  });
  return {
    conditions,
    sources,
    reading,
    firing: reading?.on === true,
    // With "or" one supplied condition is enough to watch; with "and" every one is needed.
    state: stateOf(rule, reading, rule.join === "or" ? supplied.some(Boolean) : supplied.every(Boolean)),
    percent: reading ? `${Math.round(reading.probability * 100)}%` : "–",
    firedAt: studio.firedAt[rule.id] ?? 0,
    runs: studio.fireCounts[rule.id] ?? 0,
    lastRun: studio.events.find((event) => event.ruleId === rule.id),
  };
}

const DeleteButton = ({ studio, rule }: { studio: Studio; rule: Rule }) => (
  <button
    type="button"
    onClick={() => studio.deleteRule(rule.id)}
    aria-label={`Delete automation: when ${rule.when}`}
    title="Delete"
    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] font-mono text-sm leading-none text-muted opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
  >
    ×
  </button>
);

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-line px-4 py-12 text-center">
      <p className="text-sm font-medium">No automations yet</p>
      <p className="max-w-sm text-sm text-muted">An automation watches one or more senses and calls or texts you the moment its conditions are met.</p>
      <button type="button" onClick={onAdd} className="h-8 rounded-md bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90">
        Add automation
      </button>
    </div>
  );
}

/* ---------- Every automation is a lane: its live feeds, its check over time, its action ---------- */

export function RuleLanes({ studio, now, onOpenSense, onAdd }: Shared & { onAdd: () => void }) {
  if (studio.rules.length === 0) return <Empty onAdd={onAdd} />;
  return (
    <div className="overflow-hidden rounded-md border border-line bg-card">
      {studio.rules.map((rule) => {
        const item = view(studio, rule);
        const first = item.conditions[0].sensor;
        // Two feeds fit side by side; an automation watching more shows the first two.
        const shown = item.sources.slice(0, 2);
        return (
          <article
            key={rule.id}
            className={`group relative grid h-[8.5rem] grid-cols-[15rem_minmax(0,1fr)_14rem] divide-x divide-line border-b border-line last:border-b-0 ${
              item.firing ? "bg-[var(--fire-soft)]" : ""
            }`}
          >
            {item.firedAt > 0 && <span key={item.firedAt} className="pointer-events-none absolute inset-0 z-10 animate-[lab-fired_0.9s_ease-out]" aria-hidden />}
            {!rule.enabled ? (
              // Switched off: the last thing its sensors showed, held still until it is switched back on.
              <div className="relative">
                <PausedFeed kind={first} paused={rule.paused} />
              </div>
            ) : shown.length === 0 ? (
              <button type="button" onClick={() => onOpenSense(first)} aria-label={`${SENSORS[first].label}: add a device`} className="relative text-left">
                <SensorFeed studio={studio} kind={first} emptyArt={EMPTY_ART[first]} />
              </button>
            ) : (
              <div className={`grid divide-x divide-line ${shown.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                {shown.map(({ kind, slot }) => {
                  const device = deviceById(studio.slots[kind][slot].deviceId ?? undefined);
                  return (
                    <button
                      key={`${kind}@${slot}`}
                      type="button"
                      onClick={() => onOpenSense(kind, slot)}
                      aria-label={`${SENSORS[kind].label} controls`}
                      className={`relative min-w-0 text-left ${item.firing ? "text-[var(--fire-ink)]" : ""}`}
                      style={{ "--art-ground": item.firing ? "var(--fire-soft)" : "var(--card)" } as CSSProperties}
                    >
                      <SensorFeed
                        studio={studio}
                        kind={kind}
                        slot={slot}
                        emptyArt={EMPTY_ART[kind]}
                        dense={shown.length > 1}
                        // Named only when the same sense comes from several devices; otherwise the reading says what it is.
                        caption={device && item.sources.filter((source) => source.kind === kind).length > 1 ? sourceName(device) : undefined}
                      />
                    </button>
                  );
                })}
                {item.sources.length > shown.length && (
                  <span className="absolute bottom-1 left-[13.25rem] rounded-[3px] bg-foreground px-1 font-mono text-[10px] text-background">+{item.sources.length - shown.length}</span>
                )}
              </div>
            )}
            <div className={`flex min-w-0 flex-col justify-between px-3 py-2 ${rule.enabled ? "" : "opacity-60"}`}>
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 truncate text-[13px] font-medium" title={`When ${item.conditions.map((condition) => condition.when).join(` ${rule.join ?? "and"} `)}`}>
                  {item.conditions.map((condition, index) => (
                    <Fragment key={index}>
                      {index > 0 && <span className="mx-1.5 rounded-[3px] bg-foreground px-1 py-px font-mono text-[10px] font-semibold uppercase text-background">{rule.join ?? "and"}</span>}
                      <span className={`mr-1.5 ${label}`}>{TAG[condition.sensor]}</span>
                      {condition.when}
                    </Fragment>
                  ))}
                </p>
                <span className={`ml-auto shrink-0 font-mono text-[10px] ${item.state.className}`}>{item.state.text}</span>
              </div>
              {item.conditions.length === 1 ? (
                <p className="truncate font-mono text-[11px] text-muted" title={rule.question}>
                  {rule.question}
                </p>
              ) : (
                // Each condition's own answer, so it is clear which one is holding the automation back.
                <p className="flex items-center gap-3 truncate font-mono text-[11px] text-muted">
                  {item.conditions.map((condition, index) => {
                    const part = rule.enabled ? studio.readings[conditionId(rule.id, index)] : undefined;
                    return (
                      <span key={index} title={condition.question} className={part?.on ? "font-semibold text-[var(--fire-ink)]" : ""}>
                        {TAG[condition.sensor]} {part ? `${part.on ? "YES" : "NO"} ${Math.round(part.probability * 100)}%` : "–"}
                      </span>
                    );
                  })}
                </p>
              )}
              <div className="flex items-center gap-2">
                <span className={`min-w-0 flex-1 ${item.firing ? "text-[var(--fire-ink)]" : "text-foreground"}`}>
                  <Sparkline samples={studio.history[rule.id]} now={now} height={44} />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums">{item.percent}</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-col justify-between px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={rule.enabled ? "" : "opacity-60"}>
                  <ActionIcon output={rule.output} size={24} />
                </span>
                <p className={`min-w-0 flex-1 truncate text-[13px] font-medium ${rule.enabled ? "" : "opacity-60"}`}>{describeAction(rule.output)}</p>
                <DeleteButton studio={studio} rule={rule} />
                <Toggle on={rule.enabled} onToggle={() => studio.toggleRule(rule.id)} name={`Armed: when ${rule.when}`} />
              </div>
              <p className="truncate font-mono text-[11px] text-muted" title={item.lastRun?.result}>
                {item.lastRun ? item.lastRun.result : "has not run"}
              </p>
              <p className="font-mono text-[11px] tabular-nums text-muted">
                {item.firedAt > 0 ? `ran ${item.runs} · last ${ago(item.firedAt, now)}` : "ran 0"}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}
