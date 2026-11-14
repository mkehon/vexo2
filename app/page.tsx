"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { NO_THRESHOLD, YES_THRESHOLD } from "@/lib/trigger";
import type { CompiledRule, FiredEvent, Output, Rule, Settings } from "@/lib/types";
import { useVideoSource, type VideoSource } from "@/lib/useVideoSource";
import { useWatcher, type Reading } from "@/lib/useWatcher";
import { SettingsDialog } from "./settings-dialog";

const STORAGE_KEY = "vexo.rules";
const MAX_EVENTS = 50;

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
          text: `vexo: ${rule.when}`,
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

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const video = useVideoSource(videoRef);

  const [rules, setRules] = useState<Rule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [events, setEvents] = useState<FiredEvent[]>([]);
  const [fireCounts, setFireCounts] = useState<Record<string, number>>({});

  // Rules survive a refresh. Loaded after mount so server and client render the same first page.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setRules(JSON.parse(saved));
    } catch {
      // Storage is unavailable or the saved value is unreadable: start with no rules.
    }
    setRulesLoaded(true);
  }, []);

  useEffect(() => {
    if (!rulesLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {
      // Storage is unavailable: rules last for this page view only.
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
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight">vexo</h1>
          <p className="text-sm text-muted">If the camera sees this, then do that.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {needsDetectorKey ? (
            <button
              type="button"
              className="text-sm font-medium text-danger underline underline-offset-4"
              onClick={() => setSettingsOpen(true)}
            >
              Add your TypeSafe API key to start
            </button>
          ) : (
            <StatusLine
              source={video.source}
              enabledCount={enabledCount}
              detectorMs={watcher.stats?.detectorMs}
              error={watcher.error}
            />
          )}
          <button
            type="button"
            className={`${secondaryButton} relative flex items-center gap-2`}
            onClick={() => setSettingsOpen(true)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
            </svg>
            Settings
            {needsDetectorKey && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />
            )}
          </button>
        </div>
      </header>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettings}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card step="1" title="Connect video">
          <VideoPanel videoRef={videoRef} video={video} />
        </Card>
        <RuleBuilder onCreate={(rule) => setRules((previous) => [rule, ...previous])} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Rules</h2>
        {rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
            No rules yet. Describe something to watch for above.
          </p>
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              reading={watcher.readings[rule.id]}
              hasVideo={video.source !== null}
              fires={fireCounts[rule.id] ?? 0}
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Activity</h2>
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm text-muted">
            Nothing has fired yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-center gap-4 rounded-xl border border-line bg-card p-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimize */}
                <img src={event.thumbnail} alt="" className="h-14 w-24 shrink-0 rounded-md bg-black object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{event.when}</p>
                  <p className="truncate text-sm text-muted">{event.result}</p>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums text-muted">
                  <p>{new Date(event.at).toLocaleTimeString()}</p>
                  <p>{Math.round(event.probability * 100)}% sure</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatusLine(props: {
  source: VideoSource | null;
  enabledCount: number;
  detectorMs?: number;
  error: string | null;
}) {
  const { source, enabledCount, detectorMs, error } = props;
  if (error) {
    return (
      <p role="alert" className="text-sm font-medium text-danger">
        {error}
      </p>
    );
  }
  if (!source) return <p className="text-sm text-muted">No video connected</p>;
  if (enabledCount === 0) return <p className="text-sm text-muted">Video connected. Add a rule to start watching.</p>;
  return (
    <p className="flex items-center gap-2 text-sm tabular-nums text-muted">
      <span className="h-2 w-2 animate-pulse rounded-full bg-hit" aria-hidden />
      Watching {enabledCount} {enabledCount === 1 ? "rule" : "rules"}
      {detectorMs !== undefined && ` · ${detectorMs} ms per check`}
    </p>
  );
}

function Card(props: { step: string; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs text-background">
          {props.step}
        </span>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

const secondaryButton =
  "rounded-lg border border-line px-3 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50";

function VideoPanel(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  video: ReturnType<typeof useVideoSource>;
}) {
  const { videoRef, video } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const { source } = video;

  return (
    <>
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} muted playsInline className="aspect-video w-full object-contain" />
        {!source && (
          <p className="absolute inset-0 flex items-center justify-center text-sm text-white/60">
            Pick a source below
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={secondaryButton} onClick={() => video.connectCamera()}>
          Camera
        </button>
        {video.canShareScreen && (
          <button type="button" className={secondaryButton} onClick={() => video.connectScreen()}>
            Screen or tab
          </button>
        )}
        <button type="button" className={secondaryButton} onClick={() => fileInput.current?.click()}>
          Video file
        </button>
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
        {source && (
          <button type="button" className={`${secondaryButton} ml-auto`} onClick={video.disconnect}>
            Disconnect
          </button>
        )}
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

      {source && source.kind !== "camera" && <p className="truncate text-sm text-muted">{source.label}</p>}
      {video.error && (
        <p role="alert" className="text-sm text-danger">
          {video.error}
        </p>
      )}
    </>
  );
}

const textInput =
  "w-full rounded-lg border border-line bg-background px-3 py-2.5 outline-none placeholder:text-muted focus:border-accent";

function RuleBuilder({ onCreate }: { onCreate: (rule: Rule) => void }) {
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
      if (!response.ok) throw new Error(compiled.error ?? "Could not create the rule.");

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
      setError(caught instanceof Error ? caught.message : "Could not create the rule.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card step="2" title="Define what to watch for">
        <label className="flex items-center gap-4">
          <span className="w-20 shrink-0 text-3xl font-black tracking-tight text-accent">IF</span>
          <input
            className={textInput}
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            placeholder="someone holds up a mug"
            aria-label="What to watch for"
          />
        </label>
      </Card>

      <Card step="3" title="Define what happens">
        <div className="flex items-start gap-4">
          <span className="w-20 shrink-0 text-3xl font-black tracking-tight text-hit">THEN</span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex gap-2" role="radiogroup" aria-label="What happens">
              {(
                [
                  ["speak", "Say it out loud"],
                  ["webhook", "Send a webhook"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => setKind(value)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    kind === value ? "border-foreground bg-foreground text-background" : "border-line hover:bg-background"
                  }`}
                >
                  {label}
                </button>
              ))}
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
                placeholder="https://hooks.slack.com/… or a Zapier webhook URL"
                aria-label="Webhook URL"
                inputMode="url"
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-4">
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !when.trim()}
            className="rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity disabled:opacity-40"
          >
            {busy ? "Creating…" : "Create rule"}
          </button>
        </div>
      </Card>
    </form>
  );
}

function RuleCard(props: {
  rule: Rule;
  reading?: Reading;
  hasVideo: boolean;
  fires: number;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { rule, reading, hasVideo, fires, onToggle, onDelete } = props;
  const percent = reading ? Math.round(reading.probability * 100) : 0;

  let status = "Watching";
  if (!rule.enabled) status = "Paused";
  else if (!hasVideo) status = "Connect video to start";
  else if (!reading) status = "Waiting for the first check";
  else if (reading.on) status = "Detected";

  return (
    <article
      className={`flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors ${
        reading?.on ? "border-hit" : "border-line"
      } ${rule.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium">
            <span className="mr-2 font-black text-accent">IF</span>
            {rule.when}
          </p>
          <p className="text-muted">
            <span className="mr-2 font-black text-hit">THEN</span>
            {rule.output.kind === "speak" ? `say “${rule.output.message}”` : `send a webhook to ${rule.output.url}`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" className={secondaryButton} onClick={onToggle}>
            {rule.enabled ? "Pause" : "Resume"}
          </button>
          <button type="button" className={secondaryButton} onClick={onDelete} aria-label={`Delete rule: ${rule.when}`}>
            Delete
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="relative h-2.5 flex-1 rounded-full bg-line"
          role="meter"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="How sure the detector is"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ${reading?.on ? "bg-hit" : "bg-accent"}`}
            style={{ width: `${percent}%` }}
          />
          {[NO_THRESHOLD, YES_THRESHOLD].map((threshold) => (
            <span
              key={threshold}
              className="absolute -top-1 h-4.5 w-px bg-muted"
              style={{ left: `${threshold * 100}%` }}
              aria-hidden
            />
          ))}
        </div>
        <span className="w-12 text-right text-sm font-semibold tabular-nums">{reading ? `${percent}%` : "–"}</span>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm text-muted">
        <p className="min-w-0">
          <span className={reading?.on ? "font-semibold text-hit" : "font-medium text-foreground"}>{status}</span>
          <span className="mx-2" aria-hidden>
            ·
          </span>
          Checking: “{rule.question}”
        </p>
        <p className="shrink-0 tabular-nums">
          Fired {fires} {fires === 1 ? "time" : "times"}
        </p>
      </div>
      {!rule.compiled && rule.note && <p className="text-sm text-muted">Using your sentence as written. {rule.note}</p>}
    </article>
  );
}
