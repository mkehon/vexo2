import type { ReactNode } from "react";
import type { SensorKind } from "@/lib/types";

/**
 * Building blocks shared by the page and the sensor panels: class names, panels and icons.
 */

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export const secondaryButton = `rounded-lg border border-line bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-background disabled:opacity-50 ${focusRing}`;

export const primaryButton = `rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition-opacity hover:opacity-90 disabled:opacity-40 ${focusRing}`;

export const textInput =
  "w-full rounded-xl border border-line bg-background px-3.5 py-3 outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/20";

export type Tone = "neutral" | "brand" | "hit";

export const toneBox: Record<Tone, string> = {
  neutral: "bg-background text-foreground border border-line",
  brand: "bg-brand-soft text-brand",
  hit: "bg-hit-soft text-hit",
};

export const toneText: Record<Tone, string> = {
  neutral: "text-muted",
  brand: "text-brand",
  hit: "text-hit",
};

export function Panel(props: { tone: Tone; icon: ReactNode; eyebrow: string; title: string; aside?: ReactNode; children: ReactNode }) {
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

export function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {meta && <p className="text-sm tabular-nums text-muted">{meta}</p>}
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-5 py-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}

export function Banner(props: { tone: "danger"; children: ReactNode; action?: { label: string; onClick: () => void } }) {
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

/* ---------- Controls ---------- */

export function ConnectorTile(props: { icon: ReactNode; title: string; detail: string; active: boolean; onClick: () => void }) {
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

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
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

export function Icon({ size = 18, children }: { size?: number; children: ReactNode }) {
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

export function Logo() {
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

export function EyeIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  );
}

export function DeviceIcon() {
  return (
    <Icon>
      <rect x="2" y="7" width="20" height="10" rx="5" />
      <circle cx="7.5" cy="12" r="2" />
      <circle cx="16.5" cy="12" r="2" />
    </Icon>
  );
}

export function CameraIcon() {
  return (
    <Icon>
      <path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 11" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </Icon>
  );
}

export function ScreenIcon() {
  return (
    <Icon>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Icon>
  );
}

export function FilmIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4" />
    </Icon>
  );
}

export function BoltIcon() {
  return (
    <Icon>
      <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
    </Icon>
  );
}

export function SpeakerIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </Icon>
  );
}

export function BellIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Icon>
  );
}

export function SendIcon({ size }: { size?: number } = {}) {
  return (
    <Icon size={size}>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Icon>
  );
}

export function TrashIcon() {
  return (
    <Icon size={16}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Icon>
  );
}

export function ArrowRightIcon() {
  return (
    <Icon size={16}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

export function ArrowDownIcon() {
  return (
    <Icon size={14}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </Icon>
  );
}

export function ChevronRightIcon() {
  return (
    <Icon size={14}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function GearIcon() {
  return (
    <Icon size={16}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Icon>
  );
}

export function MicIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </Icon>
  );
}

export function PinIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

export function HeartIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 21s-7.5-4.6-9.5-9.3C1 8 3.2 4.5 6.7 4.5c2 0 3.6 1 5.3 3 1.7-2 3.3-3 5.3-3 3.5 0 5.7 3.5 4.2 7.2C19.5 16.4 12 21 12 21Z" />
    </Icon>
  );
}

export function DropletIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11Z" />
    </Icon>
  );
}

export function MotionIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Icon>
  );
}

export function SlidersIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h8M16 18h4" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="14" cy="18" r="2" />
    </Icon>
  );
}

export function BluetoothIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="m7 7 10 10-5 5V2l5 5L7 17" />
    </Icon>
  );
}

/** The icon that stands for a kind of sensor. */
export function SensorIcon({ sensor, size }: { sensor: SensorKind; size?: number }) {
  switch (sensor) {
    case "sound":
      return <MicIcon size={size} />;
    case "location":
      return <PinIcon size={size} />;
    case "heart":
      return <HeartIcon size={size} />;
    case "glucose":
      return <DropletIcon size={size} />;
    case "motion":
      return <MotionIcon size={size} />;
    default:
      return <EyeIcon size={size} />;
  }
}

export function PhoneIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 3h3.5l1.7 4.6-2.2 1.5a11.5 11.5 0 0 0 6.9 6.9l1.5-2.2 4.6 1.7V19a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 3 5.2A2 2 0 0 1 5 3Z" />
    </Icon>
  );
}

export function MessageIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 13h5" />
    </Icon>
  );
}
