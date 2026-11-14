"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/brand";
import { NO_THRESHOLD, YES_THRESHOLD } from "@/lib/trigger";
import type { CompiledRule, FiredEvent, Output, Rule, Settings } from "@/lib/types";
import { useVideoSource, type VideoSource } from "@/lib/useVideoSource";
import { useWatcher, type Reading } from "@/lib/useWatcher";
import { SettingsDialog } from "./settings-dialog";

// Kept as "rules" so automations saved before the redesign still load.
const STORAGE_KEY = "vexo.rules";
const MAX_EVENTS = 50;

const TRIGGER_EXAMPLES = ["someone raises their hand", "a package is on the doorstep", "a dog is on the couch"];
const COMING_SOON = ["Smart glasses", "AI pendants", "IP cameras", "Robots & drones"];

function speak(message: string): boolean {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
  return true;
}

async function sendWebhook(rule: Rule, probability: number, at: number): Promise<string> {
  if (rule.output.kind !== "webhook") return "";
  try {
    const response = await fetch("/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: rule.output.url,
        payload: {
          // `text` is the field Slack incoming webhooks display; the rest is for Zapier and custom receivers.
          text: `${BRAND_NAME}: ${rule.when}`,
          rule: rule.when,
          probability: Number(probability.toFixed(3)),
          at: new Date(at).toISOString(),
        },
      }),
    });
    const body = await response.json();
    if (body.ok) return `Webhook sent (${body.status})`;
    return body.error ?? `Webhook failed (${body.status})`;
  } catch {
    return "Webhook failed: the local server did not respond";
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function describeAction(output: Output): string {
  if (output.kind === "speak") return `say “${output.message}” on the device`;
  let host = output.url;
  try {
    host = new URL(output.url).hostname;
  } catch {
    // Saved before URLs were checked: show it as typed.
  }
  if (host === "hooks.slack.com") return "post to Slack";
  return `send a webhook to ${host}`;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = useVideoSource(videoRef);

  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [events, setEvents] = useState<FiredEvent[]>([]);
  const [fireCounts, setFireCounts] = useState<Record<string, number>>({});

  // Automations survive a refresh. Loaded after mount so server and client render the same first page.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRules(JSON.parse(saved));
    } catch {
      // Storage is unavailable or the saved value is unreadable: start with no automations.
    }
    setRulesLoaded(true);
  }, []);

  useEffect(() => {
    if (!rulesLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {
      // Storage is unavailable: automations last for this page view only.
    }
  }, [rules, rulesLoaded]);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    fetch("/api/settings")
      .then((response) => response.json())
      .then(setSettings)
      .catch(() => {
        // Settings could not be loaded: the detector reports a missing key itself.
      });
  }, []);
  const needsDetectorKey = settings?.keys.typesafe.source === "none";

  // iPhones only let a page speak once speech has been started from a tap.
  useEffect(() => {
    const unlock = () => {
      if ("speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  const handleFire = useCallback((rule: Rule, probability: number, thumbnail: string) => {
    const event: FiredEvent = {
      id: crypto.randomUUID(),
      ruleId: rule.id,
      when: rule.when,
      at: Date.now(),
      probability,
      thumbnail,
      result: "",
    };
    const record = (result: string) =>
      setEvents((previous) => {
        const known = previous.some((item) => item.id === event.id);
        const next = known
          ? previous.map((item) => (item.id === event.id ? { ...item, result } : item))
          : [{ ...event, result }, ...previous];
        return next.slice(0, MAX_EVENTS);
      });

    setFireCounts((previous) => ({ ...previous, [rule.id]: (previous[rule.id] ?? 0) + 1 }));

    if (rule.output.kind === "speak") {
      const spoken = speak(rule.output.message);
      record(spoken ? `Said “${rule.output.message}”` : "This browser cannot speak, so it was only logged");
      return;
    }
    record("Sending webhook…");
    void sendWebhook(rule, probability, event.at).then(record);
  }, []);

  const watcher = useWatcher({
    videoRef,
    rules,
    // Without a detector key every check would fail, so wait for one.
    active: video.source !== null && !needsDetectorKey,
    onFire: handleFire,
  });
  const enabledCount = rules.filter((rule) => rule.enabled).length;

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo />
            <span className="whitespace-nowrap text-base font-bold tracking-tight sm:text-lg">{BRAND_NAME}</span>
            <span className="ml-1 hidden truncate border-l border-line pl-3 text-sm text-muted lg:inline">
              {BRAND_TAGLINE}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill
              needsKey={needsDetectorKey}
              source={video.source}
              enabledCount={enabledCount}
              detectorMs={watcher.stats?.detectorMs}
              hasError={watcher.error !== null}
            />
            <button
              type="button"
              className={`${secondaryButton} relative flex items-center gap-2`}
              onClick={() => setSettingsOpen(true)}
            >
              <GearIcon />
              <span className="hidden sm:inline">Settings</span>
              <span className="sr-only sm:hidden">Settings</span>
              {needsDetectorKey && (
                <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettings}
      />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <section className="flex flex-col gap-3">
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            When your device sees it, <span className="text-brand">your apps do it.</span>
          </h1>
          <p className="max-w-2xl text-pretty text-muted">
            Connect a phone, a webcam or any video feed. Describe a moment in plain words and choose what happens
            next. Every frame is checked, and the action runs the moment it happens.
          </p>
        </section>

        {needsDetectorKey && (
          <Banner tone="danger" action={{ label: "Open settings", onClick: () => setSettingsOpen(true) }}>
            <span className="font-semibold">One step left:</span> add your TypeSafe API key to start watching your
            devices.
          </Banner>
        )}
        {!needsDetectorKey && watcher.error && (
          <Banner tone="danger">
            <span className="font-semibold">The detector stopped:</span> {watcher.error}
          </Banner>
        )}

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <DevicePanel videoRef={videoRef} video={video} />
          <AutomationBuilder onCreate={(rule) => setRules((previous) => [rule, ...previous])} />
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Your automations"
              meta={rules.length > 0 ? `${enabledCount} on · ${rules.length - enabledCount} off` : undefined}
            />
            {rules.length === 0 ? (
              <EmptyState title="No automations yet" detail="Describe a trigger above to create your first one." />
            ) : (
              rules.map((rule) => (
                <AutomationCard
                  key={rule.id}
                  rule={rule}
                  reading={watcher.readings[rule.id]}
                  hasVideo={video.source !== null}
                  runs={fireCounts[rule.id] ?? 0}
                  onToggle={() =>
                    setRules((previous) =>
                      previous.map((item) => (item.id === rule.id ? { ...item, enabled: !item.enabled } : item)),
                    )
                  }
                  onDelete={() => setRules((previous) => previous.filter((item) => item.id !== rule.id))}
                />
              ))
            )}
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Run history"
              meta={events.length > 0 ? `${events.length} ${events.length === 1 ? "run" : "runs"}` : undefined}
            />
            {events.length === 0 ? (
              <EmptyState title="Nothing has run yet" detail="Each time an automation runs, the frame that triggered it shows up here." />
            ) : (
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <li key={event.id} className="flex items-center gap-3 rounded-xl border border-line bg-card p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimize */}
                    <img src={event.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-lg bg-black object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{event.when}</p>
                      <p className="truncate text-sm text-muted">{event.result}</p>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-muted">
                      <p>{new Date(event.at).toLocaleTimeString()}</p>
                      <p>{Math.round(event.probability * 100)}% sure</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

/* ---------- Shared pieces ---------- */

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const secondaryButton = `rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50 ${focusRing}`;

const primaryButton = `rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40 ${focusRing}`;

const textInput =
  "w-full rounded-xl border border-line bg-background px-3.5 py-3 outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20";

type Tone = "neutral" | "brand" | "hit";

const toneBox: Record<Tone, string> = {
  neutral: "bg-background text-foreground border border-line",
  brand: "bg-brand-soft text-brand",
  hit: "bg-hit-soft text-hit",
};

const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  brand: "text-brand",
  hit: "text-hit",
};

function Panel(props: { tone: Tone; icon: ReactNode; eyebrow: string; title: string; aside?: ReactNode; children: ReactNode }) {
  const { tone, icon, eyebrow, title, aside, children } = props;
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${toneBox[tone]}`}>{icon}</span>
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wider ${toneText[tone]}`}>{eyebrow}</p>
            <h2 className="truncate font-semibold">{title}</h2>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {meta && <p className="text-sm tabular-nums text-muted">{meta}</p>}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

function Banner(props: { tone: "danger"; children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm"
    >
      <p className="min-w-0">{props.children}</p>
      {props.action && (
        <button type="button" className={secondaryButton} onClick={props.action.onClick}>
          {props.action.label}
        </button>
      )}
    </div>
  );
}

function StatusPill(props: {
  needsKey: boolean;
  source: VideoSource | null;
  enabledCount: number;
  detectorMs?: number;
  hasError: boolean;
}) {
  const { needsKey, source, enabledCount, detectorMs, hasError } = props;
  let tone: "idle" | "live" | "error" = "idle";
  let text = "No device";
  if (needsKey) {
    tone = "error";
    text = "Setup needed";
  } else if (hasError) {
    tone = "error";
    text = "Detector error";
  } else if (source && enabledCount === 0) {
    text = "Device connected";
  } else if (source) {
    tone = "live";
    text = `Live · ${enabledCount} on${detectorMs !== undefined ? ` · ${detectorMs} ms` : ""}`;
  }

  const styles = {
    idle: "border-line text-muted",
    live: "border-hit/40 bg-hit-soft text-hit",
    error: "border-danger/40 bg-danger-soft text-danger",
  }[tone];
  const dot = { idle: "bg-muted/60", live: "bg-hit animate-pulse", error: "bg-danger" }[tone];

  return (
    <p
      role="status"
      className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-xs font-medium tabular-nums sm:px-3 ${styles}`}
    >
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {/* Phones show only the dot so the name fits; the video badge and banners carry the detail there. */}
      <span className="sr-only sm:not-sr-only">{text}</span>
    </p>
  );
}

/* ---------- Step 1: device ---------- */

function DevicePanel(props: { videoRef: RefObject<HTMLVideoElement | null>; video: ReturnType<typeof useVideoSource> }) {
  const { videoRef, video } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const { source } = video;

  return (
    <Panel tone="neutral" icon={<DeviceIcon />} eyebrow="1 · Device" title="Connect a device">
      <div className="relative overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline className="aspect-video w-full object-contain" />
        {!source && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
            <EyeIcon size={28} />
            <p className="text-sm">Pick a device below to start watching</p>
          </div>
        )}
        {source && (
          <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
            {source.kind === "file" ? "Replay" : "Live"}
          </span>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ConnectorTile
          icon={<CameraIcon />}
          title="Camera"
          detail="Phone, webcam or USB camera"
          active={source?.kind === "camera"}
          onClick={() => void video.connectCamera()}
        />
        {video.canShareScreen && (
          <ConnectorTile
            icon={<ScreenIcon />}
            title="Screen or tab"
            detail="A companion app or live stream"
            active={source?.kind === "screen"}
            onClick={() => void video.connectScreen()}
          />
        )}
        <ConnectorTile
          icon={<FilmIcon />}
          title="Video file"
          detail="Recorded footage, on loop"
          active={source?.kind === "file"}
          onClick={() => fileInput.current?.click()}
        />
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void video.connectFile(file);
            event.target.value = "";
          }}
        />
      </div>

      {source?.kind === "camera" && video.cameras.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-muted">
          Camera
          <select
            className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-foreground"
            value={source.deviceId ?? ""}
            onChange={(event) => void video.connectCamera(event.target.value)}
          >
            {video.cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label || "Camera"}
              </option>
            ))}
          </select>
        </label>
      )}

      {source && (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm text-muted">
            Connected: <span className="font-medium text-foreground">{source.label}</span>
          </p>
          <button type="button" className={`${secondaryButton} shrink-0`} onClick={video.disconnect}>
            Disconnect
          </button>
        </div>
      )}
      {video.error && (
        <p role="alert" className="text-sm text-danger">
          {video.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs text-muted">
        <span className="font-semibold uppercase tracking-wider">Coming soon</span>
        {COMING_SOON.map((name) => (
          <span key={name} className="rounded-full border border-dashed border-line px-2.5 py-1">
            {name}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function ConnectorTile(props: { icon: ReactNode; title: string; detail: string; active: boolean; onClick: () => void }) {
  const { icon, title, detail, active, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors sm:flex-col sm:items-start sm:gap-2 ${focusRing} ${
        active ? "border-brand bg-brand-soft" : "border-line hover:bg-background"
      }`}
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          active ? "bg-brand text-on-brand" : "bg-background text-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{detail}</span>
      </span>
    </button>
  );
}

/* ---------- Steps 2 and 3: trigger and action ---------- */

function AutomationBuilder({ onCreate }: { onCreate: (rule: Rule) => void }) {
  const [when, setWhen] = useState("");
  const [kind, setKind] = useState<Output["kind"]>("speak");
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const sentence = when.trim();
    if (!sentence || busy) return;
    if (kind === "webhook" && !isHttpUrl(url.trim())) {
      setError("Enter a webhook URL that starts with https://");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ when: sentence }),
      });
      const compiled = (await response.json()) as CompiledRule & { error?: string };
      if (!response.ok) throw new Error(compiled.error ?? "Could not create the automation.");

      onCreate({
        id: crypto.randomUUID(),
        when: sentence,
        question: compiled.question,
        yes: compiled.yes,
        no: compiled.no,
        compiled: compiled.compiled,
        note: compiled.note,
        output:
          kind === "speak"
            ? { kind: "speak", message: message.trim() || compiled.say }
            : { kind: "webhook", url: url.trim() },
        enabled: true,
      });
      setWhen("");
      setMessage("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the automation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col">
      <Panel tone="brand" icon={<EyeIcon />} eyebrow="2 · Trigger" title="When your device sees…">
        <input
          className={textInput}
          value={when}
          onChange={(event) => setWhen(event.target.value)}
          placeholder="someone holds up a mug"
          aria-label="What to watch for"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">Try:</span>
          {TRIGGER_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setWhen(example)}
              className={`rounded-full border border-line px-2.5 py-1 text-muted transition-colors hover:border-brand hover:text-brand ${focusRing}`}
            >
              {example}
            </button>
          ))}
        </div>
      </Panel>

      <StepConnector />

      <Panel tone="hit" icon={<BoltIcon />} eyebrow="3 · Action" title="Then do this">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Action">
          {(
            [
              ["speak", <SpeakerIcon key="icon" />, "Speak on device", "Say a sentence out loud"],
              ["webhook", <SendIcon key="icon" />, "Webhook", "Slack, Make, n8n, Zapier or any URL"],
            ] as const
          ).map(([value, icon, label, detail]) => {
            const selected = kind === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setKind(value)}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${focusRing} ${
                  selected ? "border-hit bg-hit-soft" : "border-line hover:bg-background"
                }`}
              >
                <span className={`mt-0.5 shrink-0 ${selected ? "text-hit" : "text-muted"}`}>{icon}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted">{detail}</span>
                </span>
              </button>
            );
          })}
        </div>
        {kind === "speak" ? (
          <input
            className={textInput}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What to say (leave empty to have it worded for you)"
            aria-label="What to say"
          />
        ) : (
          <input
            className={textInput}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://hooks.slack.com/… or any webhook URL"
            aria-label="Webhook URL"
            inputMode="url"
          />
        )}
      </Panel>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {error && (
          <p role="alert" className="min-w-0 flex-1 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !when.trim()} className={`${primaryButton} flex items-center gap-2`}>
          {busy ? "Setting it up…" : "Turn on automation"}
          {!busy && <ArrowRightIcon />}
        </button>
      </div>
    </form>
  );
}

function StepConnector() {
  return (
    <div className="flex flex-col items-center" aria-hidden>
      <span className="h-3 w-px bg-line" />
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-card text-muted">
        <ArrowDownIcon />
      </span>
      <span className="h-3 w-px bg-line" />
    </div>
  );
}

/* ---------- Automation list ---------- */

function AutomationCard(props: {
  rule: Rule;
  reading?: Reading;
  hasVideo: boolean;
  runs: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { rule, reading, hasVideo, runs, onToggle, onDelete } = props;
  const percent = reading ? Math.round(reading.probability * 100) : 0;
  const detected = rule.enabled && reading?.on === true;

  let status = { text: "Watching", className: "bg-brand-soft text-brand" };
  if (!rule.enabled) status = { text: "Off", className: "border border-line text-muted" };
  else if (!hasVideo) status = { text: "Waiting for a device", className: "border border-line text-muted" };
  else if (!reading) status = { text: "Starting…", className: "border border-line text-muted" };
  else if (reading.on) status = { text: "Detected", className: "bg-hit text-on-brand" };

  return (
    <article
      className={`flex flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors ${
        detected ? "border-hit ring-1 ring-hit" : "border-line"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className={`flex items-center gap-1.5 ${rule.enabled ? "" : "opacity-50"}`} aria-hidden>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <EyeIcon />
          </span>
          <span className="text-muted">
            <ChevronRightIcon />
          </span>
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-hit-soft text-hit">
            {rule.output.kind === "speak" ? <SpeakerIcon /> : <SendIcon />}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <label className="flex cursor-pointer items-center gap-2 pr-1 text-sm font-medium text-muted">
            {rule.enabled ? "On" : "Off"}
            <Switch on={rule.enabled} onToggle={onToggle} label={`Automation: ${rule.when}`} />
          </label>
          <button
            type="button"
            className={`rounded-lg p-2 text-muted transition-colors hover:bg-danger-soft hover:text-danger ${focusRing}`}
            onClick={onDelete}
            aria-label={`Delete automation: ${rule.when}`}
            title="Delete"
          >
            <TrashIcon />
          </button>
        </div>
      </div>

      <div className={`min-w-0 ${rule.enabled ? "" : "opacity-60"}`}>
        <p className="font-medium break-words">
          <span className="mr-1.5 text-xs font-bold uppercase tracking-wider text-brand">When</span>
          {rule.when}
        </p>
        <p
          className="break-words text-sm text-muted"
          title={rule.output.kind === "webhook" ? rule.output.url : undefined}
        >
          <span className="mr-1.5 text-xs font-bold uppercase tracking-wider text-hit">Then</span>
          {describeAction(rule.output)}
        </p>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="relative h-2 flex-1 rounded-full bg-line"
          role="meter"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="How sure the detector is"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${detected ? "bg-hit" : "bg-brand"}`}
            style={{ width: `${percent}%` }}
          />
          {[NO_THRESHOLD, YES_THRESHOLD].map((threshold) => (
            <span
              key={threshold}
              className="absolute -top-1 h-4 w-px bg-muted"
              style={{ left: `${threshold * 100}%` }}
              aria-hidden
            />
          ))}
        </div>
        <span className="w-10 text-right text-sm font-semibold tabular-nums">{reading ? `${percent}%` : "–"}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-sm text-muted">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
            {status.text}
          </span>
          <span className="min-w-0 truncate" title={rule.question}>
            Checking: “{rule.question}”
          </span>
        </div>
        <p className="shrink-0 tabular-nums">
          Ran {runs} {runs === 1 ? "time" : "times"}
        </p>
      </div>
      {!rule.compiled && rule.note && <p className="text-sm text-muted">Using your sentence as written. {rule.note}</p>}
    </article>
  );
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${focusRing} ${
        on ? "bg-brand" : "bg-line"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/* ---------- Icons ---------- */

function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <g fill="none" stroke="var(--on-brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="16" r="6" />
        <path d="M20.5 16H27M24 12.75 27.25 16 24 19.25" />
      </g>
      <circle cx="12" cy="16" r="2" fill="var(--on-brand)" />
    </svg>
  );
}

function EyeIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

function DeviceIcon() {
  return (
    <Icon>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="7.5" cy="12" r="2" />
      <circle cx="16.5" cy="12" r="2" />
    </Icon>
  );
}

function CameraIcon() {
  return (
    <Icon>
      <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </Icon>
  );
}

function ScreenIcon() {
  return (
    <Icon>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Icon>
  );
}

function FilmIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
    </Icon>
  );
}

function BoltIcon() {
  return (
    <Icon>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  );
}

function SpeakerIcon() {
  return (
    <Icon>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </Icon>
  );
}

function SendIcon() {
  return (
    <Icon>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Icon>
  );
}

function TrashIcon() {
  return (
    <Icon size={16}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Icon>
  );
}

function ArrowRightIcon() {
  return (
    <Icon size={16}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

function ArrowDownIcon() {
  return (
    <Icon size={14}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  );
}

function ChevronRightIcon() {
  return (
    <Icon size={14}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

function GearIcon() {
  return (
    <Icon size={16}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Icon>
  );
}
