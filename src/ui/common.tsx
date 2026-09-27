import { File, Folder, Globe, Rocket, Terminal, X } from "lucide-react";
import { useEffect, useId, type ReactNode } from "react";
import type { TargetKind } from "../model/types";

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="lg-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff6dc" />
          <stop offset="35%" stopColor="#ffd38a" />
          <stop offset="100%" stopColor="#ffb35a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="lg-arm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7cc4ff" />
          <stop offset="100%" stopColor="#b28cff" />
        </linearGradient>
      </defs>
      <g transform="translate(32 32) rotate(-24)">
        <ellipse rx="25" ry="8" fill="none" stroke="#7cc4ff" strokeOpacity="0.4" strokeWidth="1.2" />
        <path d="M-5 0C-5 -12 7.5 -19 19 -14M5 0C5 12 -7.5 19 -19 14" fill="none" stroke="url(#lg-arm)" strokeWidth="3.6" strokeLinecap="round" />
        <circle r="12" fill="url(#lg-core)" />
        <circle cx="25" cy="0" r="2.2" fill="#d8ecff" />
      </g>
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/** Icône d'une planète : image, émoji, ou pictogramme selon le type de cible. */
export function Glyph({ icon, kind, size = 18 }: { icon?: string; kind?: TargetKind; size?: number }) {
  if (icon?.startsWith("data:")) return <img src={icon} alt="" draggable={false} style={{ width: size, height: size }} />;
  if (icon) return <span style={{ fontSize: size * 0.9 }}>{icon}</span>;
  const Icon = kind === "url" ? Globe : kind === "folder" ? Folder : kind === "file" ? File : kind === "command" ? Terminal : Rocket;
  return <Icon style={{ width: size * 0.85, height: size * 0.85 }} />;
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id} style={disabled ? { opacity: 0.5, cursor: "default" } : undefined}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={`switch ${checked ? "is-on" : ""}`} aria-hidden="true" />
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Ferme avec Échap (sans laisser la touche atteindre les raccourcis globaux). */
export function useEscape(onClose: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, active]);
}

export function Sheet({ title, subtitle, onClose, children, footer }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEscape(onClose);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <aside className="sheet glass" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </aside>
    </>
  );
}

export function Dialog({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEscape(onClose);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <section className={`dialog glass ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="dialog-head">
          <div style={{ flex: 1 }}>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </section>
    </>
  );
}

export function formatBytes(n: number): string {
  if (!n) return "0 o";
  const units = ["o", "Ko", "Mo", "Go", "To"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0).replace(".", ",")} ${units[i]}`;
}

export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} j ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

export const TARGET_LABELS: Record<TargetKind, string> = {
  app: "Application",
  file: "Fichier",
  folder: "Dossier",
  url: "Lien",
  command: "Commande",
};
