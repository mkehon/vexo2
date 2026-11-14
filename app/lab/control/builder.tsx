"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { appById, deviceById, sourceName } from "@/lib/catalog";
import { SENSOR_ORDER, SENSORS } from "@/lib/sensors";
import { TEMPLATE_CATEGORIES, TEMPLATES, type Template } from "@/lib/templates";
import type { SensorKind } from "@/lib/types";
import type { Composer, DraftCondition } from "@/lib/useComposer";
import type { Studio } from "@/lib/useStudio";
import { MessageIcon, PhoneIcon, SensorIcon } from "../../ui";
import { DeviceMenu } from "../device-gallery";
import { SensorFeed } from "../feeds";
import { BrandIcon } from "../visuals";
import { EMPTY_ART, label, Spinner, TAG } from "./shared";

/**
 * The automation builder, as IF … THEN …. The IF is one or more rows, each a sensor, the
 * devices to watch it on and what to watch for, joined by AND or OR. The THEN is a call or a
 * text. Every row is checked live against its devices before the automation is armed.
 */

/** Apps an automation will be able to send to. Shown so people know they are on the way. */
const COMING_SOON = ["slack", "google-calendar", "gmail"];
const TEMPLATES_KEY = "vexo.templates";

const field = "h-9 rounded-md border border-line bg-background px-3 text-sm outline-none focus:border-foreground";
const word = "font-mono text-[15px] font-semibold text-[var(--fire-ink)]";

/** The words a row's sentence starts with, such as "the heart rate". */
const leadOf = (sensor: SensorKind) => SENSORS[sensor].triggerTitle.replace(/^When\s+/, "").replace(/…$/, "");

function TemplateCard({ template, onChoose }: { template: Template; onChoose: () => void }) {
  return (
    <button type="button" onClick={onChoose} className="flex w-full flex-col gap-1 rounded-md border border-line bg-card p-2.5 text-left transition-colors hover:border-foreground">
      <span className="flex items-center gap-1.5">
        {template.conditions.map((condition, index) => (
          <Fragment key={index}>
            {index > 0 && <span className="font-mono text-[9px] font-semibold uppercase text-muted">{template.join ?? "and"}</span>}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-brand-soft">
              <SensorIcon sensor={condition.sensor} size={11} />
            </span>
          </Fragment>
        ))}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden>
          <path d="m9 6 6 6-6 6" />
        </svg>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-hit text-white">
          {template.action === "call" ? <PhoneIcon size={11} /> : <MessageIcon size={11} />}
        </span>
        <span className="ml-1 truncate text-[13px] font-semibold">{template.title}</span>
      </span>
      <span className="text-xs leading-snug text-muted">{template.description}</span>
    </button>
  );
}

/** One row of the IF: the sensor, the devices, the sentence, and what the detector says right now. */
function ConditionRow(props: {
  studio: Studio;
  composer: Composer;
  condition: DraftCondition;
  removable: boolean;
  onOpenControls: (sense: SensorKind, slot: number) => void;
}) {
  const { studio, composer, condition, removable, onOpenControls } = props;
  const { sensor } = condition;
  const slots = studio.slots[sensor];
  // The devices this row listens to: the ones it names, or every one connected for the sensor.
  const connected = slots.flatMap((slot) => (slot.connected && slot.deviceId ? [slot.deviceId] : []));
  const listening = condition.devices ?? connected;
  const feeds = slots.flatMap((slot, index) => (slot.connected && (!slot.deviceId || listening.includes(slot.deviceId) || condition.devices === null) ? [index] : []));
  const readingId = composer.readingId(condition);
  const reading = readingId ? studio.readings[readingId] : undefined;
  const thinking = composer.isThinking(condition);

  return (
    <div className={`rounded-md border p-2.5 transition-colors ${reading?.on ? "border-[var(--fire)] bg-[var(--fire-soft)]" : "border-line bg-card"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div role="radiogroup" aria-label="Sensor" className="flex overflow-hidden rounded-md border border-line">
          {SENSOR_ORDER.map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={kind === sensor}
              aria-label={SENSORS[kind].label}
              title={SENSORS[kind].label}
              onClick={() => composer.setSensor(condition.key, kind)}
              className={`flex h-7 items-center gap-1 border-r border-line px-2 font-mono text-[10px] font-medium uppercase tracking-[0.04em] transition-colors last:border-r-0 ${
                kind === sensor ? "bg-foreground text-background" : "text-muted hover:bg-background hover:text-foreground"
              }`}
            >
              <SensorIcon sensor={kind} size={12} />
              {TAG[kind]}
            </button>
          ))}
        </div>

        <span className={label}>on</span>
        {listening.map((id, index) => {
          const device = deviceById(id);
          const slot = slots.findIndex((item) => item.connected && item.deviceId === id);
          if (!device) return null;
          return (
            <Fragment key={id}>
              {index > 0 && <span className={label}>or</span>}
              <span className={`flex h-7 items-center rounded-md border text-xs font-medium ${slot >= 0 ? "border-line bg-card" : "border-dashed border-line text-muted"}`}>
                <button
                  type="button"
                  onClick={() => (slot >= 0 ? onOpenControls(sensor, slot) : undefined)}
                  title={slot >= 0 ? "Open its controls" : "Not connected"}
                  className="flex h-full items-center gap-1.5 pl-1 pr-2"
                >
                  {device.icon ? <BrandIcon icon={device.icon} size={18} /> : <span className={`h-1.5 w-1.5 rounded-full ${slot >= 0 ? "bg-hit" : "bg-muted/50"}`} aria-hidden />}
                  {sourceName(device)}
                </button>
                {listening.length > 1 && (
                  <button
                    type="button"
                    onClick={() => composer.setDevices(condition.key, listening.filter((item) => item !== id))}
                    aria-label={`Do not watch ${device.name}`}
                    title="Leave this device out of this condition"
                    className="flex h-full w-5 items-center justify-center border-l border-line text-muted hover:text-danger"
                  >
                    ×
                  </button>
                )}
              </span>
            </Fragment>
          );
        })}
        <DeviceMenu
          studio={studio}
          sense={sensor}
          urgent={listening.length === 0}
          onPicked={(device, result) => {
            if (condition.devices && !condition.devices.includes(device.id)) composer.setDevices(condition.key, [...condition.devices, device.id]);
            if (result.controls) onOpenControls(sensor, result.slot);
          }}
        />

        <span className="ml-auto flex items-center gap-2">
          {thinking ? (
            <Spinner />
          ) : reading ? (
            <span className={`flex items-baseline gap-1.5 font-mono ${reading.on ? "text-[var(--fire-ink)]" : ""}`}>
              <span className="text-[15px] font-semibold leading-none">{reading.on ? "YES" : "NO"}</span>
              <span className="text-[11px] tabular-nums text-muted">{Math.round(reading.probability * 100)}%</span>
            </span>
          ) : null}
          {removable && (
            <button
              type="button"
              onClick={() => composer.removeCondition(condition.key)}
              aria-label="Remove this condition"
              title="Remove"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] font-mono text-sm text-muted hover:bg-danger-soft hover:text-danger"
            >
              ×
            </button>
          )}
        </span>
      </div>

      <div className="mt-2 flex gap-2.5">
        <div className="flex shrink-0 gap-1.5">
          {(feeds.length > 0 ? feeds : [0]).map((slot) => {
            const on = readingId ? studio.readings[`${readingId}@${slot}`]?.on : false;
            const device = deviceById(slots[slot].deviceId ?? undefined);
            return (
              <div
                key={slot}
                className={`relative h-[5.5rem] overflow-hidden rounded-[5px] border ${feeds.length > 2 ? "w-28" : "w-36"} ${on ? "border-[var(--fire)] text-[var(--fire-ink)]" : "border-line"}`}
                style={{ "--art-ground": "var(--card)" } as CSSProperties}
              >
                <SensorFeed studio={studio} kind={sensor} slot={slot} emptyArt={EMPTY_ART[sensor]} dense caption={feeds.length > 1 && device ? sourceName(device) : undefined} />
              </div>
            );
          })}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label className="flex h-10 items-center gap-2 rounded-md border border-line bg-background px-3 focus-within:border-foreground">
            <span className="shrink-0 font-mono text-[13px] text-muted">{leadOf(sensor)}</span>
            <input
              value={condition.text}
              onChange={(event) => composer.setText(condition.key, event.target.value)}
              placeholder={SENSORS[sensor].placeholder}
              aria-label={`${SENSORS[sensor].triggerTitle}`}
              autoComplete="off"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:text-muted/60"
            />
          </label>
          <p className="line-clamp-2 font-mono text-[11px] leading-snug text-muted">
            {thinking
              ? "Working out what to check…"
              : readingId && condition.compiled
                ? `Checks: ${condition.compiled.question}`
                : `For example: ${SENSORS[sensor].examples.slice(0, 2).join(", or ")}.`}
          </p>
        </div>
      </div>
    </div>
  );
}

export function AutomationBuilder(props: {
  open: boolean;
  studio: Studio;
  composer: Composer;
  now: number;
  onOpenControls: (sense: SensorKind, slot: number) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  const { open, studio, composer, now, onOpenControls, onOpenSettings, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const { conditions, join, reading } = composer;

  // Whether the templates are showing. Remembered, since it is a matter of taste.
  const [templates, setTemplates] = useState(true);
  useEffect(() => {
    try {
      setTemplates(localStorage.getItem(TEMPLATES_KEY) !== "hidden");
    } catch {
      // Storage is unavailable: the templates show.
    }
  }, []);
  const showTemplates = (show: boolean) => {
    setTemplates(show);
    try {
      localStorage.setItem(TEMPLATES_KEY, show ? "shown" : "hidden");
    } catch {
      // Storage is unavailable: it lasts for this page view.
    }
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  const close = () => {
    composer.discard();
    onClose();
  };

  // Whether the chosen way of reaching a phone is set up. Unknown until the settings load.
  const reach = studio.settings?.reach;
  const reachable = composer.action === "text" ? reach?.text : reach?.call;
  const justFired = now - composer.wouldHaveFiredAt < 4000;
  const written = conditions.filter((condition) => condition.text.trim());

  return (
    <dialog
      ref={dialog}
      onClose={close}
      // A click on the dimmed area around the panel lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      aria-labelledby="builder-title"
      className={`m-auto h-[85vh] max-w-[92rem] overflow-hidden rounded-xl border border-line bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/55 ${
        templates ? "w-[85vw]" : "w-[min(85vw,62rem)]"
      }`}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (composer.turnOn()) onClose();
        }}
        className={`grid h-full ${templates ? "grid-cols-[19rem_minmax(0,1fr)]" : "grid-cols-1"}`}
      >
        {templates && (
          <aside className="flex min-h-0 flex-col border-r border-line bg-background">
            <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
              <h2 className="text-[13px] font-semibold">Templates</h2>
              <button type="button" onClick={() => showTemplates(false)} className="text-xs font-medium text-muted hover:text-foreground">
                Hide
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 outline-none">
              {TEMPLATE_CATEGORIES.map((category) => (
                <div key={category} className="mt-3 first:mt-0">
                  <h3 className={`px-1 pb-1 ${label}`}>{category}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {TEMPLATES.filter((template) => template.category === category).map((template) => (
                      <li key={template.id}>
                        <TemplateCard template={template} onChoose={() => composer.applyTemplate(template)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </aside>
        )}

        <div className="flex min-h-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-5">
            <h2 id="builder-title" className="text-[15px] font-semibold">
              New automation
            </h2>
            <div className="flex items-center gap-2">
              {!templates && (
                <button type="button" onClick={() => showTemplates(true)} className="h-8 rounded-md border border-line px-3 text-xs font-medium hover:bg-background">
                  Templates
                </button>
              )}
              <button type="button" onClick={close} className="h-8 rounded-md border border-line px-3 text-xs font-medium hover:bg-background">
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 outline-none">
            {/* ---------- IF ---------- */}
            <div className="grid grid-cols-[3.25rem_minmax(0,1fr)]">
              <span className={`pt-3 ${word}`}>IF</span>
              <div className="flex flex-col">
                {conditions.map((condition, index) => (
                  <Fragment key={condition.key}>
                    {index > 0 && (
                      <div className="flex items-center gap-2 py-1.5 pl-3">
                        <div role="radiogroup" aria-label="How the conditions combine" className="flex overflow-hidden rounded-md border border-foreground">
                          {(["and", "or"] as const).map((option) => (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={join === option}
                              onClick={() => composer.setJoin(option)}
                              className={`h-6 px-2.5 font-mono text-[11px] font-semibold uppercase ${join === option ? "bg-foreground text-background" : "text-muted hover:text-foreground"}`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                        {index === 1 && <span className="text-xs text-muted">{join === "and" ? "All of these must hold at the same time." : "Any one of these is enough."}</span>}
                      </div>
                    )}
                    <ConditionRow studio={studio} composer={composer} condition={condition} removable={conditions.length > 1} onOpenControls={onOpenControls} />
                  </Fragment>
                ))}
                {composer.canAdd && (
                  <button
                    type="button"
                    onClick={composer.addCondition}
                    className="mt-2 flex h-8 items-center gap-1.5 self-start rounded-md border border-dashed border-line px-3 text-xs font-semibold text-muted transition-colors hover:border-foreground hover:text-foreground"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add a condition
                    <span className="font-mono font-normal uppercase">and / or</span>
                  </button>
                )}
              </div>
            </div>

            {/* ---------- THEN ---------- */}
            <div className="mt-6 grid grid-cols-[3.25rem_minmax(0,1fr)]">
              <span className={`pt-2 ${word}`}>THEN</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div role="radiogroup" aria-label="What happens" className="flex gap-1.5">
                    {(
                      [
                        ["call", "Call me", <PhoneIcon key="icon" size={14} />],
                        ["text", "Text me", <MessageIcon key="icon" size={14} />],
                      ] as const
                    ).map(([kind, name, icon]) => (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={composer.action === kind}
                        onClick={() => composer.setAction(kind)}
                        className={`flex h-9 items-center gap-2 rounded-md border pl-1.5 pr-3 text-[13px] font-semibold transition-colors ${
                          composer.action === kind ? "border-foreground bg-background" : "border-line text-muted hover:border-muted"
                        }`}
                      >
                        <span className={`flex h-6 w-6 items-center justify-center rounded-[5px] ${composer.action === kind ? "bg-hit text-white" : "bg-brand-soft"}`}>{icon}</span>
                        {name}
                      </button>
                    ))}
                  </div>
                  <span className={label}>at</span>
                  <input
                    value={composer.phone}
                    onChange={(event) => composer.setPhone(event.target.value)}
                    aria-label="Phone number"
                    placeholder="+1 415 555 0100"
                    inputMode="tel"
                    autoComplete="tel"
                    className={`${field} w-44 font-mono`}
                  />
                  <span className={label}>{composer.action === "text" ? "saying" : "and say"}</span>
                  <input
                    value={composer.message}
                    onChange={(event) => composer.setMessage(event.target.value)}
                    aria-label={composer.action === "text" ? "The message" : "What the voice says"}
                    placeholder={composer.action === "text" ? "The message to send" : "What the voice says when you pick up"}
                    className={`${field} min-w-[14rem] flex-1`}
                  />
                </div>
                <p className="mt-2 text-xs text-muted">
                  {composer.action === "call"
                    ? "Your phone rings and a voice agent says it, along with what the sensor read. You can ask it a question."
                    : "You get a text with it, along with what the sensor read."}
                  {reachable && reach?.number ? ` It comes from ${reach.number}.` : ""}
                </p>
                {reachable === false && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--fire-ink)]">
                    {composer.action === "text" ? "Texts need a Twilio Account SID and Auth Token." : "Calls need an ElevenLabs key."} Until then a run is logged without
                    reaching the phone.
                    <button type="button" onClick={onOpenSettings} className="font-semibold underline underline-offset-2">
                      Open Settings
                    </button>
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  <span className={`mr-1 ${label}`}>Coming soon</span>
                  {COMING_SOON.map((id) => {
                    const item = appById(id);
                    if (!item) return null;
                    return (
                      <span key={id} className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-line pl-1 pr-2 text-[11px] font-medium text-muted">
                        <span className="opacity-60">
                          <BrandIcon icon={item.icon} size={18} />
                        </span>
                        {item.name}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-14 shrink-0 items-center justify-between gap-5 border-t border-line bg-[#FAFAF7] px-5">
            <p className="min-w-0 text-[13px]" role={composer.error ? "alert" : undefined}>
              {composer.error ? (
                <span className="text-danger">{composer.error}</span>
              ) : written.length > 0 ? (
                <span className="line-clamp-2">
                  <span className="font-semibold">If</span>{" "}
                  {written.map((condition, index) => (
                    <Fragment key={condition.key}>
                      {index > 0 && <span className="font-semibold"> {join} </span>}
                      {leadOf(condition.sensor)} {condition.text.trim()}
                    </Fragment>
                  ))}
                  , <span className="font-semibold">then</span> {composer.action} {composer.phone.trim() || "your phone"}.
                </span>
              ) : (
                <span className="text-muted">Pick a sensor and finish its sentence{templates ? ", or start from a template" : ""}.</span>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              {reading && (
                <span className={`font-mono text-[11px] ${justFired || reading.on ? "font-semibold text-[var(--fire-ink)]" : "text-muted"}`}>
                  {justFired ? "WOULD HAVE FIRED JUST NOW" : reading.on ? "TRUE RIGHT NOW" : "NOT TRUE RIGHT NOW"}
                </span>
              )}
              <button type="button" onClick={close} className="h-9 rounded-md px-3 text-[13px] font-medium text-muted hover:text-foreground">
                Cancel
              </button>
              <button
                type="submit"
                disabled={written.length === 0}
                className="h-9 rounded-md bg-foreground px-5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-35"
              >
                Arm automation
              </button>
            </div>
          </div>
        </div>
      </form>
    </dialog>
  );
}
