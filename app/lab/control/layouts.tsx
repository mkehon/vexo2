"use client";

import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { sourceLabel } from "@/lib/catalog";
import { conditionId, conditionsOf, nameOf, outputsOf, SENSORS } from "@/lib/sensors";
import type { Rule, SensorKind } from "@/lib/types";
import type { Studio } from "@/lib/useStudio";
import { SensorIcon } from "../../ui";
import { MiniFeed, PausedFeed, SensorFeed } from "../feeds";
import { ago, describeAction, Sparkline } from "../parts";
import { ActionIcon } from "../visuals";
import { EMPTY_ART, label, stateOf, TAG, Toggle } from "./shared";

/**
 * The automations, each as a card: a title bar that is always there, and under it what the
 * automation watches, live. A card folds down to its title bar, which still says how it stands.
 *
 * One that checks a single thing on a single device shows that device's feed large. One that
 * checks several things, or one thing on several devices, shows a compact row per condition,
 * so it is plain which of them hold right now.
 */

type Shared = {
  studio: Studio;
  now: number;
  /** Opens the controls of a connected sense. */
  onOpenSense: (kind: SensorKind, slot?: number) => void;
  /** Connects a source an automation names, by its id. */
  onConnect: (sourceId: string, kind: SensorKind) => void;
  /** Opens the builder on an automation, to change it. */
  onEdit: (rule: Rule) => void;
};

/** Everything a card shows about one automation. */
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
  // The first source it names that is not connected.
  const missing = conditions
    .flatMap((condition) => (condition.devices ?? []).map((id) => ({ id, kind: condition.sensor })))
    .find(({ id, kind }) => !studio.slots[kind].some((slot) => slot.connected && slot.deviceId === id));
  return {
    conditions,
    sources,
    missing,
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

type View = ReturnType<typeof view>;

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

const iconButton = "flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors";

/* ---------- The title bar: the name, how it stands, what it does, and its switch ---------- */

function TitleBar({ studio, now, rule, item, onEdit }: Shared & { rule: Rule; item: View }) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const name = nameOf(rule);
  const outputs = outputsOf(rule);
  const folded = rule.collapsed === true;
  const fold = () => studio.collapseRule(!folded, rule.id);
  const finish = (save: boolean) => {
    if (save) studio.renameRule(rule.id, draft);
    setRenaming(false);
  };
  // A dot for how it stands: orange and pulsing when true, green when watching, grey when it cannot or is off.
  const watching = rule.enabled && item.reading !== undefined;
  const dot = item.firing ? "animate-pulse bg-[var(--fire)]" : watching ? "bg-hit" : "bg-muted/40";

  return (
    <div
      onClick={fold}
      title={folded ? "Click to unfold" : "Click to fold"}
      className={`flex h-10 cursor-pointer select-none items-center gap-2 pl-1.5 pr-3 ${folded ? "" : "border-b border-line"} ${rule.enabled ? "" : "text-muted"}`}
    >
      <button
        type="button"
        aria-expanded={!folded}
        aria-label={`${folded ? "Unfold" : "Fold"} ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          fold();
        }}
        className={`${iconButton} hover:bg-background hover:text-foreground`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${folded ? "" : "rotate-90"}`} aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
      </button>
      <span className={`-mr-1 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />

      {renaming ? (
        <input
          autoFocus
          onFocus={(event) => event.target.select()}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => finish(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finish(true);
            if (event.key === "Escape") finish(false);
          }}
          maxLength={60}
          aria-label="Name of the automation"
          placeholder="Leave empty to name it after what it watches"
          className="h-7 min-w-0 flex-1 rounded-[4px] border border-foreground bg-card px-2 text-[13px] font-semibold text-foreground outline-none"
        />
      ) : (
        <>
          {/* The title is the one part of the bar that does not fold the card: clicking it renames. */}
          <h3 className={`min-w-0 ${folded ? "max-w-[45%] shrink-0" : "flex-1"}`}>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setDraft(rule.name ?? "");
                setRenaming(true);
              }}
              title="Click to rename"
              className="block max-w-full cursor-text truncate rounded-[4px] px-1 py-0.5 text-left text-[13px] font-semibold hover:bg-background"
            >
              {name}
            </button>
          </h3>
          {/* Folded, the bar also says what it watches, since nothing else does. */}
          {folded && (
            <p className="min-w-0 flex-1 truncate text-xs text-muted">
              {item.conditions.map((condition, index) => (
                <Fragment key={index}>
                  {index > 0 && <span className="mx-1 font-mono text-[10px] font-semibold uppercase">{rule.join ?? "and"}</span>}
                  <span className="mr-1 font-mono text-[10px] font-medium uppercase">{TAG[condition.sensor]}</span>
                  {condition.when}
                </Fragment>
              ))}
            </p>
          )}
        </>
      )}

      <span className={`shrink-0 font-mono text-[10px] ${item.state.className}`}>{item.state.text}</span>
      {folded && rule.enabled && (
        <span className={`hidden w-20 shrink-0 md:block ${item.firing ? "text-[var(--fire-ink)]" : "text-foreground"}`}>
          <Sparkline samples={studio.history[rule.id]} now={now} height={16} />
        </span>
      )}
      <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums">{item.percent}</span>

      <span className={`ml-1 flex shrink-0 items-center gap-1 ${rule.enabled ? "" : "opacity-60"}`} title={outputs.map(describeAction).join(", ")}>
        {outputs.map((output, index) => (
          <ActionIcon key={index} output={output} size={20} />
        ))}
      </span>
      <span className="hidden w-[7.5rem] shrink-0 truncate text-right font-mono text-[10px] tabular-nums text-muted xl:block">
        {item.firedAt > 0 ? `ran ${item.runs} · ${ago(item.firedAt, now)}` : "has not run"}
      </span>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onEdit(rule);
        }}
        aria-label={`Edit automation: when ${rule.when}`}
        title="Edit"
        className={`${iconButton} border border-line hover:border-foreground hover:text-foreground`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M17 3l4 4L8 20l-5 1 1-5Z" />
        </svg>
      </button>
      <Toggle on={rule.enabled} onToggle={() => studio.toggleRule(rule.id)} name={`Armed: when ${rule.when}`} />
    </div>
  );
}

/** The right end of an unfolded card: each thing it does, and how its last run went. */
function ActionCell({ rule, item }: { rule: Rule; item: View }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 px-3 py-2">
      <ul className={`flex flex-col gap-1 ${rule.enabled ? "" : "opacity-60"}`}>
        {outputsOf(rule).map((output, index) => (
          <li key={index} className="flex items-center gap-2">
            <ActionIcon output={output} size={18} />
            <span className="min-w-0 truncate text-[12px] font-medium" title={describeAction(output)}>
              {describeAction(output)}
            </span>
          </li>
        ))}
      </ul>
      <p className="line-clamp-2 font-mono text-[11px] leading-snug text-muted" title={item.lastRun?.result}>
        {item.lastRun ? item.lastRun.result : "has not run"}
      </p>
    </div>
  );
}

/* ---------- One thing on one device: its feed, large, beside its check over time ---------- */

function SimpleBody({ studio, now, rule, item, onOpenSense, onConnect, onEdit }: Shared & { rule: Rule; item: View }) {
  const condition = item.conditions[0];
  const source = item.sources[0];
  return (
    <div className="grid h-[7.5rem] grid-cols-[13.5rem_minmax(0,1fr)_14rem] divide-x divide-line">
      {!rule.enabled ? (
        // Switched off: the last thing its sensor showed, held still until it is switched back on.
        <div className="relative">
          <PausedFeed kind={condition.sensor} paused={rule.paused} />
        </div>
      ) : !source ? (
        // Nothing it watches is connected. Its own device is one click away; with none named, the editor is.
        <button
          type="button"
          onClick={() => (item.missing ? onConnect(item.missing.id, item.missing.kind) : onEdit(rule))}
          aria-label={item.missing ? `Connect ${sourceLabel(item.missing.id)}` : `${SENSORS[condition.sensor].label}: add a device`}
          className="relative text-left"
        >
          <SensorFeed studio={studio} kind={condition.sensor} emptyArt={EMPTY_ART[condition.sensor]} empty emptyLabel={item.missing ? `Connect ${sourceLabel(item.missing.id)}` : "Add a device"} />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpenSense(source.kind, source.slot)}
          aria-label={`${SENSORS[source.kind].label} controls`}
          className={`relative min-w-0 text-left ${item.firing ? "text-[var(--fire-ink)]" : ""}`}
          style={{ "--art-ground": item.firing ? "var(--fire-soft)" : "var(--card)" } as CSSProperties}
        >
          <SensorFeed studio={studio} kind={source.kind} slot={source.slot} emptyArt={EMPTY_ART[source.kind]} />
        </button>
      )}
      {/* What it watches for is the automation itself: clicking it opens it for editing. */}
      <div
        onClick={() => onEdit(rule)}
        title="Click to edit"
        className={`flex min-w-0 cursor-pointer flex-col justify-between px-3 py-2 transition-colors hover:bg-background/60 ${rule.enabled ? "" : "opacity-60"}`}
      >
        <p className="min-w-0 truncate text-[13px] font-medium" title={`When ${condition.when}`}>
          <span className={`mr-1.5 ${label}`}>{TAG[condition.sensor]}</span>
          {condition.when}
        </p>
        <p className="truncate font-mono text-[11px] text-muted" title={rule.question}>
          {rule.question}
        </p>
        <span className={item.firing ? "text-[var(--fire-ink)]" : "text-foreground"}>
          <Sparkline samples={studio.history[rule.id]} now={now} height={40} />
        </span>
      </div>
      <ActionCell rule={rule} item={item} />
    </div>
  );
}

/* ---------- Several things at once: a row for each, with its own picture and its own answer ---------- */

const thumb = "relative flex h-8 min-w-14 shrink-0 items-center justify-center overflow-hidden rounded-[4px] border bg-card";
/** A camera's picture in a row: large enough to make out what it shows. */
const picture = "h-[3.75rem] w-[6.5rem] bg-black";

/** A source being pointed at, and where its thumbnail is on the screen, for the larger look at it. */
type Peek = { kind: SensorKind; slot: number; left: number; top: number };
const PEEK_WIDTH = 352;
const PEEK_HEIGHT = 224;

/** Where a thumbnail's larger picture goes: under it, or above when there is no room below. */
function peekAt(kind: SensorKind, slot: number, element: HTMLElement): Peek {
  const box = element.getBoundingClientRect();
  const below = box.bottom + 8 + PEEK_HEIGHT <= window.innerHeight;
  return {
    kind,
    slot,
    left: Math.max(8, Math.min(box.left, window.innerWidth - PEEK_WIDTH - 8)),
    top: below ? box.bottom + 8 : Math.max(8, box.top - 8 - PEEK_HEIGHT),
  };
}

function CompoundBody({ studio, now, rule, item, onOpenSense, onConnect, onEdit }: Shared & { rule: Rule; item: View }) {
  const any = rule.join === "or";
  const several = item.conditions.length > 1;
  /** The camera whose thumbnail the pointer is on, shown larger beside it. */
  const [peek, setPeek] = useState<Peek | null>(null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_14rem] divide-x divide-line">
      <div className={`flex min-w-0 flex-col gap-1 px-3 py-2 ${rule.enabled ? "" : "opacity-60"}`}>
        {/* How the rows combine, and the whole of it over the last minute. */}
        <div onClick={() => onEdit(rule)} title="Click to edit" className="flex cursor-pointer items-center gap-2">
          <span className={label}>{several ? (any ? "Any of these" : "All of these") : "On any of these devices"}</span>
          <span className={`ml-auto w-44 shrink-0 ${item.firing ? "text-[var(--fire-ink)]" : "text-foreground"}`}>
            <Sparkline samples={studio.history[rule.id]} now={now} height={18} />
          </span>
        </div>

        <ul className="flex flex-col gap-0.5">
          {item.conditions.map((condition, index) => {
            const id = conditionId(rule.id, index);
            const part = rule.enabled ? studio.readings[id] : undefined;
            const live = rule.enabled ? studio.slotsFor(condition) : [];
            // The sources it names that are not connected, each a click away from being so.
            const absent = (condition.devices ?? []).filter((source) => !studio.slots[condition.sensor].some((slot) => slot.connected && slot.deviceId === source));
            return (
              <li key={index} className={`flex min-h-10 items-center gap-2 rounded-[5px] py-1 pl-1 pr-2 ${part?.on ? "bg-[var(--fire)]/10 ring-1 ring-inset ring-[var(--fire)]/50" : ""}`}>
                <span className="w-7 shrink-0 text-center font-mono text-[10px] font-semibold uppercase text-muted">{index === 0 ? "if" : any ? "or" : "and"}</span>

                <span className="flex shrink-0 items-center gap-1">
                  {!rule.enabled && (
                    <span className={`${thumb} border-line text-muted`}>
                      <SensorIcon sensor={condition.sensor} size={14} />
                    </span>
                  )}
                  {live.map((slot) => {
                    const on = studio.readings[`${id}@${slot}`]?.on === true;
                    const camera = condition.sensor === "camera";
                    const name = sourceLabel(studio.slots[condition.sensor][slot].deviceId ?? "");
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => onOpenSense(condition.sensor, slot)}
                        onMouseEnter={(event) => camera && setPeek(peekAt(condition.sensor, slot, event.currentTarget))}
                        onMouseLeave={() => setPeek(null)}
                        title={camera ? undefined : `${name}: open its controls`}
                        aria-label={`${SENSORS[condition.sensor].label} controls: ${name}`}
                        className={`${thumb} ${on ? "border-[var(--fire)] text-[var(--fire-ink)] ring-1 ring-[var(--fire)]" : "border-line"} ${camera ? picture : ""}`}
                      >
                        <MiniFeed studio={studio} kind={condition.sensor} slot={slot} />
                        {/* Which device this picture is from, since several sit side by side. */}
                        {camera && <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-px text-left text-[9px] font-medium leading-tight text-white">{name}</span>}
                      </button>
                    );
                  })}
                  {rule.enabled &&
                    absent.map((source) => (
                      <button
                        key={source}
                        type="button"
                        onClick={() => onConnect(source, condition.sensor)}
                        aria-label={`Connect ${sourceLabel(source)}`}
                        title={`${sourceLabel(source)} is not connected. Click to connect it.`}
                        className={`${thumb} border-dashed border-line px-1.5 font-mono text-[10px] font-medium uppercase text-[var(--fire-ink)] hover:border-foreground`}
                      >
                        Connect
                      </button>
                    ))}
                  {rule.enabled && live.length === 0 && absent.length === 0 && (
                    <button type="button" onClick={() => onEdit(rule)} className={`${thumb} border-dashed border-line px-1.5 font-mono text-[10px] font-medium uppercase text-muted hover:border-foreground`}>
                      No device
                    </button>
                  )}
                </span>

                <p onClick={() => onEdit(rule)} title={condition.question} className="min-w-0 flex-1 cursor-pointer truncate text-[13px] font-medium">
                  <span className={`mr-1.5 ${label}`}>{TAG[condition.sensor]}</span>
                  {condition.when}
                </p>
                <span className="hidden max-w-[12rem] shrink-0 truncate font-mono text-[10px] text-muted xl:block">
                  {[...live.map((slot) => studio.slots[condition.sensor][slot].deviceId ?? ""), ...absent].filter(Boolean).map(sourceLabel).join(" / ")}
                </span>
                <span className={`w-[4.25rem] shrink-0 text-right font-mono text-[11px] tabular-nums ${part?.on ? "font-semibold text-[var(--fire-ink)]" : "text-muted"}`}>
                  {part ? `${part.on ? "YES" : "NO"} ${Math.round(part.probability * 100)}%` : "–"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <ActionCell rule={rule} item={item} />
      {/* Pointing at a camera's thumbnail shows it larger. Fixed to the window, so the card's edges do not cut it off. */}
      {peek && studio.slots[peek.kind][peek.slot]?.connected && (
        <div className="pointer-events-none fixed z-50 overflow-hidden rounded-md border border-foreground bg-black shadow-2xl" style={{ left: peek.left, top: peek.top, width: PEEK_WIDTH }}>
          <div className="aspect-video">
            <MiniFeed studio={studio} kind={peek.kind} slot={peek.slot} />
          </div>
          <p className="truncate bg-foreground px-2 py-1 font-mono text-[11px] text-background">{sourceLabel(studio.slots[peek.kind][peek.slot].deviceId ?? "")}</p>
        </div>
      )}
    </div>
  );
}

/** One automation: its title bar, and under it, unless folded, what it watches. */
function Card({ rule, item, children, ...shared }: Shared & { rule: Rule; item: View; children: ReactNode }) {
  return (
    <article className={`group relative overflow-hidden rounded-md border ${item.firing ? "border-[var(--fire)]/60 bg-[var(--fire-soft)]" : "border-line bg-card"}`}>
      {item.firedAt > 0 && <span key={item.firedAt} className="pointer-events-none absolute inset-0 z-10 animate-[lab-fired_0.9s_ease-out]" aria-hidden />}
      <TitleBar {...shared} rule={rule} item={item} />
      {!rule.collapsed && children}
    </article>
  );
}

export function RuleLanes({ onAdd, ...shared }: Shared & { onAdd: () => void }) {
  const { studio } = shared;
  if (studio.rules.length === 0) return <Empty onAdd={onAdd} />;
  const allFolded = studio.rules.every((rule) => rule.collapsed);
  const armed = studio.rules.filter((rule) => rule.enabled).length;
  return (
    <section aria-label="Automations" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <h2 className={label}>
          Automations <span className="ml-1 text-foreground">{studio.rules.length}</span>
          <span className="ml-2 normal-case tracking-normal">{armed === studio.rules.length ? "all armed" : `${armed} armed`}</span>
        </h2>
        <button type="button" onClick={() => studio.collapseRule(!allFolded)} className={`${label} rounded-[4px] px-1.5 py-0.5 hover:bg-card hover:text-foreground`}>
          {allFolded ? "Unfold all" : "Fold all"}
        </button>
      </div>
      {studio.rules.map((rule) => {
        const item = view(studio, rule);
        // Several conditions, or one condition watched on several devices, get a row each.
        const sourcesNamed = item.conditions.reduce((total, condition) => total + Math.max(condition.devices?.length ?? 0, studio.slotsFor(condition).length), 0);
        const Body = item.conditions.length > 1 || sourcesNamed > 1 ? CompoundBody : SimpleBody;
        return (
          <Card key={rule.id} {...shared} rule={rule} item={item}>
            <Body {...shared} rule={rule} item={item} />
          </Card>
        );
      })}
    </section>
  );
}
