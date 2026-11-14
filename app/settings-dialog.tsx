"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PROVIDER_ORDER, PROVIDERS } from "@/lib/providers";
import type { KeyName, KeyStatus, Provider, Settings } from "@/lib/types";

function describe(status: KeyStatus): string {
  if (status.source === "none") return "Not set";
  const ending = status.hint ? `, ending in ${status.hint}` : "";
  return status.source === "app" ? `Saved${ending}` : `Set in .env.local${ending}`;
}

const input =
  "min-w-0 flex-1 rounded-lg border border-line bg-background px-3 py-2 outline-none placeholder:text-muted focus:border-accent";
const button = "rounded-lg border border-line px-3 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50";

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
    return { ok: false, text: "Could not reach the vexo server." };
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
                ? "Keys are saved on this computer and used by every device that opens vexo from it, including your phone."
                : "Settings are saved on the computer running vexo and can only be changed there."}
            </p>

            <section className="flex flex-col gap-2 rounded-xl border border-line p-4">
              <KeyField
                name="typesafe"
                label="TypeSafe API key"
                required
                status={settings.keys.typesafe}
                canEdit={settings.canEdit}
                onChange={onChange}
              />
              <p className="text-sm text-muted">Runs the detection on every frame.</p>
            </section>

            <SharpeningSection settings={settings} onChange={onChange} />
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
    <section className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div>
        <h3 className="font-medium">
          Rule sharpening <span className="font-normal text-muted">(optional)</span>
        </h3>
        <p className="text-sm text-muted">
          An AI model turns each rule into a clearer question for the detector. Without a key, rules use your
          sentence as written.
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
                option === provider ? "border-foreground bg-foreground text-background" : "border-line hover:bg-background"
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
