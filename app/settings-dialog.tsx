"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PROVIDER_ORDER, PROVIDERS } from "@/lib/providers";
import type { KeyName, KeyStatus, PhoneNumber, Provider, Settings } from "@/lib/types";

function describe(status: KeyStatus): string {
  if (status.source === "none") return "Not set";
  const ending = status.hint ? `, ending in ${status.hint}` : "";
  return status.source === "app" ? `Saved${ending}` : `Set in .env.local${ending}`;
}

const input =
  "min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20";
const button = "rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50";

/** Sends a change to the server and returns the message to show, plus the updated settings. */
async function update(body: object): Promise<{ ok: boolean; text: string; settings?: Settings }> {
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    return { ok: response.ok, text: result.message ?? result.error ?? "", settings: result.settings };
  } catch {
    return { ok: false, text: "Could not reach the app's server on this computer." };
  }
}

export function SettingsDialog(props: {
  open: boolean;
  settings: Settings | null;
  onClose: () => void;
  onChange: (settings: Settings) => void;
}) {
  const { open, settings, onClose, onChange } = props;
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      // A click on the dimmed area around the panel lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby="settings-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-card p-0 text-foreground backdrop:bg-black/60"
    >
      <div className="flex flex-col gap-5 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="settings-title" className="text-lg font-semibold">
            Settings
          </h2>
          <button type="button" className={button} onClick={onClose}>
            Close
          </button>
        </div>

        {!settings ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {settings.canEdit
                ? "Keys are saved on this computer and used by every device that opens the app from it, including your phone."
                : "Settings are saved on the computer running the app and can only be changed there."}
            </p>

            <section className="flex flex-col gap-2 rounded-xl border border-line bg-background/50 p-4">
              <KeyField
                name="typesafe"
                label="TypeSafe API key"
                required
                status={settings.keys.typesafe}
                canEdit={settings.canEdit}
                onChange={onChange}
              />
              <p className="text-sm text-muted">Runs detection on every frame your devices send.</p>
            </section>

            <SharpeningSection settings={settings} onChange={onChange} />

            <ReachSection settings={settings} onChange={onChange} />
          </>
        )}
      </div>
    </dialog>
  );
}

function SharpeningSection({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const { provider, canEdit } = settings;
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: Provider) => {
    if (next === provider) return;
    const result = await update({ provider: next });
    if (result.settings) onChange(result.settings);
    setError(result.ok ? null : result.text);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-background/50 p-4">
      <div>
        <h3 className="font-medium">
          Trigger sharpening <span className="font-normal text-muted">(optional)</span>
        </h3>
        <p className="text-sm text-muted">
          An AI model turns each trigger into a clearer yes/no question for the detector. Without a key, triggers use
          your sentence as written.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Provider">
        {PROVIDER_ORDER.map((option) => {
          const hasKey = settings.keys[option].source !== "none";
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={option === provider}
              disabled={!canEdit}
              onClick={() => void choose(option)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-default ${
                option === provider ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-background"
              }`}
            >
              {PROVIDERS[option].label}
              <span
                className={`h-2 w-2 rounded-full ${hasKey ? "bg-hit" : "border border-current opacity-50"}`}
                role="img"
                aria-label={hasKey ? "key saved" : "no key"}
              />
            </button>
          );
        })}
      </div>

      {/* Keyed by provider so a half-typed key does not carry over when switching. */}
      <KeyField
        key={provider}
        name={provider}
        label={`${PROVIDERS[provider].label} API key`}
        status={settings.keys[provider]}
        canEdit={canEdit}
        onChange={onChange}
      />
      <p className="text-sm text-muted">Uses the model {PROVIDERS[provider].model}.</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** The same place the builder keeps the number to reach, so a test here fills it in there. */
const PHONE_KEY = "vexo.phone";

function ReachSection({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  const { canEdit, reach, keys } = settings;
  const hasKey = keys.elevenlabs.source !== "none";
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [numberId, setNumberId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"number" | "call" | "text" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    try {
      setPhone(localStorage.getItem(PHONE_KEY) ?? "");
    } catch {
      // Storage is unavailable: the field starts empty.
    }
  }, []);

  // The account's numbers, asked for once there is a key to ask with.
  useEffect(() => {
    if (!canEdit || !hasKey) return;
    let cancelled = false;
    fetch("/api/reach")
      .then((response) => response.json())
      .then((body: { numbers?: PhoneNumber[]; numberId?: string; error?: string }) => {
        if (cancelled) return;
        setNumbers(body.numbers ?? []);
        setNumberId(body.numberId ?? "");
        if (body.error) setNote({ ok: false, text: body.error });
      })
      .catch(() => {
        if (!cancelled) setNote({ ok: false, text: "Could not load the phone numbers." });
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, hasKey, reach.number]);

  const choose = async (id: string) => {
    setBusy("number");
    setNote(null);
    try {
      const response = await fetch("/api/reach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ numberId: id }),
      });
      const body = await response.json();
      if (body.settings) onChange(body.settings);
      if (response.ok) setNumberId(id);
      setNote({ ok: response.ok, text: body.message ?? body.error ?? "Something went wrong." });
    } catch {
      setNote({ ok: false, text: "Could not reach the app's server on this computer." });
    }
    setBusy(null);
  };

  const test = async (kind: "call" | "text") => {
    setBusy(kind);
    setNote(null);
    try {
      const response = await fetch("/api/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          to: phone,
          message: "This is a test. Your automations can reach this phone",
          when: "you press the test button in Settings",
          sensor: "none, this is a test",
          confirm: true,
        }),
      });
      const body = await response.json();
      if (response.ok) localStorage.setItem(PHONE_KEY, phone.trim());
      setNote({ ok: response.ok, text: body.result ?? body.error ?? "Something went wrong." });
    } catch {
      setNote({ ok: false, text: "Could not reach the app's server on this computer." });
    }
    setBusy(null);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-background/50 p-4">
      <div>
        <h3 className="font-medium">
          Calls and texts <span className="font-normal text-muted">(optional)</span>
        </h3>
        <p className="text-sm text-muted">
          An automation can phone you, where a voice agent says what happened and answers a question about it, or send
          you a text.
        </p>
      </div>

      <KeyField name="elevenlabs" label="ElevenLabs API key" status={keys.elevenlabs} canEdit={canEdit} onChange={onChange} />
      <p className="text-sm text-muted">
        Places the calls, through a voice agent named “Sensor alert line (hackathon)” that the app adds to the
        ElevenLabs account.
      </p>

      {canEdit && numbers.length > 0 && (
        <label className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="font-medium">Call and text from</span>
          <select
            value={numberId}
            disabled={busy !== null}
            onChange={(event) => void choose(event.target.value)}
            className="min-w-0 max-w-full rounded-lg border border-line bg-background px-3 py-2 text-sm outline-none focus:border-brand"
          >
            {!numberId && <option value="">Choose a number</option>}
            {numbers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.number}
                {item.label ? ` · ${item.label}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {!canEdit && reach.number && <p className="text-sm text-muted">Calls and texts come from {reach.number}.</p>}

      <KeyField name="twilioSid" label="Twilio Account SID" status={keys.twilioSid} canEdit={canEdit} onChange={onChange} />
      <KeyField name="twilioToken" label="Twilio Auth Token" status={keys.twilioToken} canEdit={canEdit} onChange={onChange} />
      <p className="text-sm text-muted">
        Sends the texts, from the same number. It has to be a number in this Twilio account, and US carriers only
        deliver texts from a number registered for A2P 10DLC.
      </p>

      {canEdit && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <label htmlFor="reach-test" className="font-medium">
            Try it on your phone
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="reach-test"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+1 415 555 0100"
              inputMode="tel"
              autoComplete="tel"
              className={input}
            />
            <button type="button" className={button} disabled={busy !== null || !phone.trim() || !reach.call} onClick={() => void test("call")}>
              {busy === "call" ? "Calling…" : "Call me"}
            </button>
            <button type="button" className={button} disabled={busy !== null || !phone.trim() || !reach.text} onClick={() => void test("text")}>
              {busy === "text" ? "Sending…" : "Text me"}
            </button>
          </div>
        </div>
      )}

      {note && (
        <p role="status" className={`text-sm ${note.ok ? "text-muted" : "text-danger"}`}>
          {note.text}
        </p>
      )}
    </section>
  );
}

function KeyField(props: {
  name: KeyName;
  label: string;
  required?: boolean;
  status: KeyStatus;
  canEdit: boolean;
  onChange: (settings: Settings) => void;
}) {
  const { name, label, required = false, status, canEdit, onChange } = props;
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async (next: string | null) => {
    setBusy(true);
    setResult(null);
    const outcome = await update({ name, value: next });
    if (outcome.settings) onChange(outcome.settings);
    setResult({ ok: outcome.ok, text: outcome.text || "Something went wrong." });
    if (outcome.ok) setValue("");
    setBusy(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) void send(value);
  };

  const missing = status.source === "none";
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <label htmlFor={`key-${name}`} className="font-medium">
          {label} {required && <span className="font-normal text-muted">(required)</span>}
        </label>
        <span className={`text-sm ${missing ? (required ? "text-danger" : "text-muted") : "text-hit"}`}>
          {describe(status)}
        </span>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <input
            id={`key-${name}`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            className={input}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={missing ? "Paste the key" : "Paste a new key to replace it"}
          />
          <button type="submit" className={button} disabled={busy || !value.trim()}>
            {busy ? "Checking…" : "Save"}
          </button>
          {status.source === "app" && (
            <button type="button" className={button} disabled={busy} onClick={() => void send(null)}>
              Remove
            </button>
          )}
        </div>
      )}

      {result && (
        <p role="status" className={`text-sm ${result.ok ? "text-muted" : "text-danger"}`}>
          {result.text}
        </p>
      )}
    </form>
  );
}
