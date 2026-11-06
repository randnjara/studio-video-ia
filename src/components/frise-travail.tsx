"use client";

import { useEffect, useState } from "react";
import { annulerTravail, lireTravaux } from "@/app/(studio)/travaux-actions";
import type { Travail } from "@/lib/travaux";
import { LIBELLES_TYPES, dureeLisible, estFinale, frise } from "@/lib/travaux-etapes";

// Frise en direct d'un travail serveur (RunPod) : ✓ / ⏳ / ✗, heure, durée et % de chaque étape, qui reste visible après la
// fin. Toutes les frises d'une page sont suivies par un seul appel toutes les 4 s.

const SILENCE_MAX_MIN = 4;
const abonnes = new Map<string, Set<(t: Travail | null) => void>>();
let minuterie: ReturnType<typeof setInterval> | null = null;
const finis = new Map<string, Travail>();

async function tour() {
  const ids = [...abonnes.keys()].filter((id) => !finis.has(id));
  if (ids.length === 0) return;
  const travaux = await lireTravaux(ids).catch(() => null);
  if (!travaux) return;
  for (const id of ids) {
    const t = travaux.find((x) => x.runpod_job_id === id) ?? null;
    if (t && estFinale(t.statut)) finis.set(id, t);
    abonnes.get(id)?.forEach((f) => f(t));
  }
}

function suivre(id: string, f: (t: Travail | null) => void) {
  if (finis.has(id)) {
    f(finis.get(id)!);
    return () => undefined;
  }
  if (!abonnes.has(id)) abonnes.set(id, new Set());
  abonnes.get(id)!.add(f);
  void tour();
  minuterie ??= setInterval(() => void tour(), 4000);
  return () => {
    abonnes.get(id)?.delete(f);
    if (!abonnes.get(id)?.size) abonnes.delete(id);
    if (abonnes.size === 0 && minuterie) {
      clearInterval(minuterie);
      minuterie = null;
    }
  };
}

const heure = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

export function FriseTravail({
  jobId,
  enAttente = "En attente d'envoi au serveur…",
  onRelancer,
  compacte = false,
}: {
  jobId: string | null | undefined;
  enAttente?: string;
  onRelancer?: () => void;
  compacte?: boolean;
}) {
  const [travail, setTravail] = useState<Travail | null>(null);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const [detail, setDetail] = useState(false);
  const [annulation, setAnnulation] = useState("");

  useEffect(() => {
    setTravail(null);
    if (!jobId || jobId === "envoi") return;
    return suivre(jobId, setTravail);
  }, [jobId]);
  // Les durées de l'étape en cours avancent chaque seconde
  useEffect(() => {
    if (travail && estFinale(travail.statut)) return;
    const t = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(t);
  }, [travail]);

  if (!jobId || jobId === "envoi" || !travail)
    return <p className="text-sm text-sourdine">⏳ {!jobId || jobId === "envoi" ? enAttente : "Envoyé au serveur, en attente de ses nouvelles…"}</p>;

  const f = frise(travail.travaux_evenements ?? [], travail.statut, maintenant);
  const etapes = compacte && f.etapes.length > 3 ? f.etapes.slice(-3) : f.etapes;
  return (
    <div className="flex flex-col gap-1 text-xs" aria-live="polite">
      <p className="font-semibold">
        {LIBELLES_TYPES[travail.type] ?? travail.type} · {dureeLisible(f.total)}
        {travail.cout_usd !== null ? ` · ${Number(travail.cout_usd).toFixed(3)} $` : ""}
      </p>
      <ol className="flex flex-col gap-0.5">
        {etapes.map((e) => (
          <li key={`${e.etape}-${e.debut}`} className={e.etat === "echoue" ? "text-alerte" : e.etat === "en_cours" ? "text-accent" : ""}>
            {e.etat === "fait" ? "✓" : e.etat === "en_cours" ? "⏳" : "✗"} {e.libelle}
            <span className="text-sourdine">
              {" "}
              · {heure(e.debut)}
              {e.duree !== null && e.etape !== "termine" ? ` · ${dureeLisible(e.duree)}` : ""}
              {e.progression !== null && e.etape !== "termine" ? ` · ${e.progression} %` : ""}
            </span>
            {e.message && <span className="text-sourdine"> · {e.message}</span>}
            {e.etat === "en_cours" && e.progression !== null && (
              <span className="mt-0.5 block h-1 overflow-hidden rounded bg-surface-2">
                <span className="block h-full bg-[var(--accent)]" style={{ width: `${e.progression}%` }} />
              </span>
            )}
          </li>
        ))}
      </ol>
      {travail.erreur && <p className="text-alerte">✗ {travail.erreur}</p>}
      {f.silenceMinutes >= SILENCE_MAX_MIN && (
        <div className="flex flex-wrap items-center gap-2 rounded bg-alerte/10 px-2 py-1 text-alerte">
          Pas de nouvelle du serveur depuis {f.silenceMinutes} min.
          {onRelancer && (
            <button type="button" className="lien" onClick={onRelancer}>
              Relancer
            </button>
          )}
          <button
            type="button"
            className="lien"
            disabled={annulation === "encours"}
            onClick={async () => {
              setAnnulation("encours");
              const r = await annulerTravail(jobId).catch(() => ({ erreur: "Connexion perdue." }));
              setAnnulation(r.erreur ?? "Annulation demandée.");
            }}
          >
            Annuler
          </button>
          {annulation && annulation !== "encours" && <span>{annulation}</span>}
        </div>
      )}
      <button type="button" className="lien self-start" onClick={() => setDetail((d) => !d)}>
        {detail ? "Masquer le détail" : "Voir le détail"}
      </button>
      {detail && (
        <div className="rounded bg-surface-2 p-2 font-mono text-[11px]">
          <p>Serveur {travail.serveur} · travail {travail.runpod_job_id}</p>
          {(travail.travaux_evenements ?? [])
            .slice()
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((e, i) => (
              <p key={i}>
                {heure(e.created_at)} {e.etape}
                {e.progression !== null ? ` ${e.progression}%` : ""} {e.message}
              </p>
            ))}
          {travail.erreur_detail && <pre className="mt-1 whitespace-pre-wrap">{travail.erreur_detail}</pre>}
        </div>
      )}
    </div>
  );
}
