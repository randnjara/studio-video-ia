"use client";

import { useState } from "react";
import { ajouterPreset } from "@/app/(studio)/voix/actions";
import { AGES, GENRES, type Reglages } from "@/lib/voix";

// Garde les réglages de la table comme une nouvelle voix du catalogue (ex. « Grand-mère du film »)
export function AjoutPreset({ voixId, reglages }: { voixId: string; reglages: Reglages }) {
  const [ouvert, setOuvert] = useState(false);
  const [nom, setNom] = useState("");
  const [genre, setGenre] = useState("femme");
  const [age, setAge] = useState("adulte");
  const [etat, setEtat] = useState<{ envoi: boolean; message?: string; erreur?: string }>({ envoi: false });

  if (!ouvert)
    return (
      <button type="button" className="rounded-lg border border-zinc-600 px-3 py-2 text-sm font-semibold" onClick={() => setOuvert(true)}>
        ★ Garder comme nouvelle voix
      </button>
    );

  async function garder() {
    setEtat({ envoi: true });
    const r = await ajouterPreset({ voixId, nom, genre, age, reglages }).catch(() => ({ erreur: "Connexion perdue." }));
    setEtat(r.erreur ? { envoi: false, erreur: r.erreur } : { envoi: false, message: `« ${nom} » est ajoutée au catalogue des voix.` });
    if (!r.erreur) setNom("");
  }

  const champ = "rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1.5 text-sm";
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-zinc-800 p-2">
      <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom (ex. : Grand-mère du film)" className={`${champ} min-w-48 flex-1`} />
      <select value={genre} onChange={(e) => setGenre(e.target.value)} className={champ} aria-label="Genre">
        {Object.entries(GENRES).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      <select value={age} onChange={(e) => setAge(e.target.value)} className={champ} aria-label="Âge">
        {Object.entries(AGES).map(([v, n]) => (
          <option key={v} value={v}>
            {n}
          </option>
        ))}
      </select>
      <button type="button" className="bouton py-1.5" disabled={etat.envoi || !nom.trim()} onClick={() => void garder()}>
        {etat.envoi ? "…" : "Garder"}
      </button>
      <button type="button" className="text-sm text-zinc-400" onClick={() => setOuvert(false)}>
        Fermer
      </button>
      {etat.message && <p className="w-full text-sm text-emerald-300">{etat.message}</p>}
      {etat.erreur && <p className="w-full text-sm text-red-300">{etat.erreur}</p>}
    </div>
  );
}
