"use client";

import { useMemo, useState } from "react";
import { AGES, GENRES, MOTEURS_VOIX, type Voix, nomLangue } from "@/lib/voix";
import { supprimerVoix } from "./actions";

// Le catalogue, filtrable par langue, genre et âge
export function Catalogue({ voix, moi, responsable }: { voix: Voix[]; moi: string; responsable: boolean }) {
  const [langue, setLangue] = useState("tout");
  const [genre, setGenre] = useState("tout");
  const [age, setAge] = useState("tout");

  const langues = useMemo(
    () =>
      [...new Set(voix.map((v) => v.langue))].sort((a, b) =>
        a === "mg" ? -1 : b === "mg" ? 1 : nomLangue(a).localeCompare(nomLangue(b)),
      ),
    [voix],
  );
  const visibles = voix.filter(
    (v) => (langue === "tout" || v.langue === langue) && (genre === "tout" || v.genre === genre) && (age === "tout" || v.age === age),
  );

  const puce = (actif: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${actif ? "border-accent bg-accent-doux text-accent" : "border-ligne text-sourdine hover:text-encre"}`;

  return (
    <section className="carte flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold">Catalogue</h2>
        <span className="text-sm text-sourdine">
          {visibles.length} voix sur {voix.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={puce(langue === "tout")} onClick={() => setLangue("tout")}>
            Toutes les langues
          </button>
          {langues.map((l) => (
            <button key={l} type="button" className={puce(langue === l)} onClick={() => setLangue(l)}>
              {nomLangue(l)} ({voix.filter((v) => v.langue === l).length})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[["tout", "Tous"], ...Object.entries(GENRES)].map(([v, n]) => (
            <button key={v} type="button" className={puce(genre === v)} onClick={() => setGenre(v)}>
              {n}
            </button>
          ))}
          <span className="mx-1 w-px bg-ligne" />
          {[["tout", "Tous âges"], ...Object.entries(AGES)].map(([v, n]) => (
            <button key={v} type="button" className={puce(age === v)} onClick={() => setAge(v)}>
              {n}
            </button>
          ))}
        </div>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {visibles.map((v) => (
          <li key={v.id} className="flex flex-col gap-1 rounded-lg border border-ligne p-3 text-sm">
            <div className="flex items-start gap-2">
              <b className="flex-1">{v.nom}</b>
              {(responsable || (v.created_by === moi && !v.par_defaut)) && (
                <button
                  type="button"
                  className="text-xs text-alerte hover:underline"
                  onClick={async () => {
                    if (confirm(`Supprimer la voix « ${v.nom} » du catalogue ?`)) await supprimerVoix(v.id);
                  }}
                >
                  Supprimer
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              <span className="pastille bg-surface-2 text-sourdine">{nomLangue(v.langue)}</span>
              <span className="pastille bg-surface-2 text-sourdine">{GENRES[v.genre]}</span>
              {v.age !== "adulte" && <span className="pastille bg-accent-doux text-accent">{AGES[v.age]}</span>}
              <span className="pastille bg-surface-2 text-sourdine">{MOTEURS_VOIX[v.moteur]}</span>
              {!v.usage_commercial && <span className="pastille bg-alerte-doux text-alerte">⚠ Non commercial</span>}
              {!v.par_defaut && <span className="pastille bg-succes-doux text-succes">Ajoutée</span>}
            </div>
            {v.description && <p className="text-xs text-sourdine">{v.description}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
