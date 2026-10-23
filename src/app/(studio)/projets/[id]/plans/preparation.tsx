"use client";

import { useState } from "react";
import { promptPreparation } from "@/lib/preparation";
import { enregistrerScript } from "./actions";

type Ref = { nom: string; genre: string; description: string };

// Préparation du tableau des plans avec un assistant gratuit : la voix off est collée ici (et gardée dans le projet),
// le bouton copie la consigne complète à coller dans ChatGPT avec la photo du personnage.
export function PreparationTableau(p: { projectId: string; titre: string; format: string; style: string; script: string; refs: Ref[] }) {
  const [voix, setVoix] = useState(p.script);
  const [etat, setEtat] = useState<"" | "copie" | "manuel">("");
  const texte = promptPreparation({ titre: p.titre, format: p.format, style: p.style, script: voix, refs: p.refs });

  async function copier() {
    if (voix.trim() !== p.script.trim()) enregistrerScript(p.projectId, voix).catch(() => undefined);
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
    } catch {
      setEtat("manuel");
    }
  }

  return (
    <details className="rounded-lg border border-ligne p-4 text-sm">
      <summary className="cursor-pointer font-semibold">🤖 Préparer le tableau des plans avec ChatGPT (gratuit)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sourdine">
          Ajoutez d'abord les références du film (personnage principal, lieux) et le style, plus bas. Collez la voix off
          ci-dessous, une réplique par ligne, puis copiez la consigne : collez-la dans ChatGPT avec la photo du personnage. Il
          répond avec un bloc CSV ; enregistrez-le dans un fichier .csv et importez-le juste en dessous.
        </p>
        <div>
          <label className="etiquette" htmlFor="voix-preparation">
            Voix off (une réplique par ligne, dans sa langue d'origine)
          </label>
          <textarea
            id="voix-preparation"
            rows={6}
            value={voix}
            onChange={(e) => setVoix(e.target.value)}
            className="champ text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="bouton" onClick={copier} disabled={!voix.trim()}>
            📋 Copier le prompt de préparation
          </button>
          {etat === "copie" && <span className="text-succes">Copié. Collez-le dans ChatGPT avec la photo.</span>}
        </div>
        {etat === "manuel" && (
          <textarea readOnly className="champ h-48 font-mono text-xs" value={texte} onFocus={(e) => e.target.select()} />
        )}
      </div>
    </details>
  );
}
