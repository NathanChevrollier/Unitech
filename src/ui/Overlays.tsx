import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { activeGalaxy, findSystem } from "../model/ops";
import { useUi } from "../store/ui";
import { useWorkspace } from "../store/workspace";
import { currentSystemId } from "../app/actions";
import { Logo } from "./common";

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.tone === "success" ? <CircleCheck /> : t.tone === "error" ? <CircleAlert /> : <Info />}
          <span>{t.text}</span>
          {t.action && (
            <button
              className="btn btn-small"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => dismiss(t.id)} aria-label="Fermer">
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

export function Flash() {
  const flash = useUi((s) => s.flash);
  return flash ? <div key={flash} className="flash" /> : null;
}

export function Boot() {
  const status = useWorkspace((s) => s.status);
  const error = useWorkspace((s) => s.error);
  const ready = useUi((s) => s.galaxyReady);
  const done = status === "ready" && ready;
  return (
    <div className={`boot ${done ? "is-done" : ""}`} aria-hidden={done}>
      <div className="boot-inner">
        <Logo className="boot-logo" />
        <div className="boot-title">UNITECH</div>
        {status === "error" ? (
          <div className="boot-error">Impossible de charger l'espace de travail : {error}</div>
        ) : (
          <div className="boot-sub">{status === "loading" ? "Ouverture de ton espace de travail…" : "Formation de la Voie lactée…"}</div>
        )}
      </div>
    </div>
  );
}

export function DropOverlay() {
  const drop = useUi((s) => s.drop);
  const ws = useWorkspace((s) => s.ws);
  if (!drop || !ws) return null;
  const sid = currentSystemId();
  const sys = sid ? findSystem(activeGalaxy(ws), sid) : undefined;
  return (
    <div className="drop" style={{ "--x": `${drop.x}px`, "--y": `${drop.y}px` } as React.CSSProperties}>
      <div className="drop-card glass">Dépose pour créer des planètes autour de {sys?.name ?? "ton étoile"}</div>
    </div>
  );
}
