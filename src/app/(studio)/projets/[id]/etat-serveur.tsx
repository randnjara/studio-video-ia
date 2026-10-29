"use client";

import { useCallback, useEffect, useState } from "react";
import type { EtatServeur } from "@/lib/surveillance";

// Sous la barre de progression : l'état de la machine RunPod et un petit historique horodaté de ce qui s'est passé.
// L'historique est gardé dans l'onglet du navigateur (il survit au rafraîchissement de la page, pas à sa fermeture).
type Ligne = { heure: string; texte: string; ton: EtatServeur["ton"] };
const MAX_LIGNES = 30;

export function useJournalServeur(cle: string) {
  const [journal, setJournal] = useState<Ligne[]>([]);

  useEffect(() => {
    try {
      const lu = JSON.parse(sessionStorage.getItem(cle) ?? "[]");
      if (Array.isArray(lu)) setJournal(lu.slice(-MAX_LIGNES));
    } catch {}
  }, [cle]);

  // Ajoute une ligne seulement si elle dit autre chose que la précédente
  const noter = useCallback(
    (texte: string, ton: EtatServeur["ton"] = "ok") =>
      setJournal((avant) => {
        if (avant.at(-1)?.texte === texte) return avant;
        const heure = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        const apres = [...avant, { heure, texte, ton }].slice(-MAX_LIGNES);
        try {
          sessionStorage.setItem(cle, JSON.stringify(apres));
        } catch {}
        return apres;
      }),
    [cle],
  );

  return { journal, noter };
}

const COULEUR: Record<EtatServeur["ton"], string> = { ok: "bg-succes", attente: "bg-accent", alerte: "bg-alerte" };
const minutes = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`);

export function EtatServeurVue({ etat, journal }: { etat: EtatServeur | null; journal: Ligne[] }) {
  return (
    <div className="w-full space-y-2 text-xs">
      <p className="flex flex-wrap items-center gap-2">
        <span className={`inline-block size-2 rounded-full ${etat ? COULEUR[etat.ton] : "bg-sourdine"}`} aria-hidden />
        <span className="font-medium">{etat ? etat.texte : "Connexion à RunPod…"}</span>
        {etat && !etat.arret && etat.inactifS > 0 && (
          <span className="opacity-80">
            Sans résultat depuis {minutes(etat.inactifS)} : arrêt automatique à {minutes(etat.limiteS)}.
          </span>
        )}
      </p>
      {journal.length > 0 && (
        <details open className="rounded-md bg-surface px-3 py-2 text-encre">
          <summary className="cursor-pointer select-none">Historique</summary>
          <ol className="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono">
            {[...journal].reverse().map((l, i) => (
              <li key={`${l.heure}-${i}`} className={l.ton === "alerte" ? "text-alerte" : undefined}>
                {l.heure} · {l.texte}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
