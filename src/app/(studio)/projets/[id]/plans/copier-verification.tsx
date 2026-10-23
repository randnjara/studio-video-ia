"use client";

import { useState } from "react";

// Copie le prompt de vérification : la personne le colle dans un assistant gratuit (ChatGPT, Claude, Gemini…)
export function CopierVerification({ texte }: { texte: string }) {
  const [etat, setEtat] = useState<"" | "copie" | "manuel">("");

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      setEtat("copie");
    } catch {
      setEtat("manuel");
    }
  }

  return (
    <details className="carte text-sm">
      <summary className="cursor-pointer font-semibold">Vérifier le script et la continuité (gratuit)</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sourdine">
          Le bouton copie une consigne complète avec votre script et tous les plans. Collez-la dans un assistant gratuit
          (ChatGPT, Claude, Gemini…) et joignez les photos de départ dans l'ordre si possible. Il répond avec un tableau des
          plans à corriger et les consignes corrigées, prêtes à recopier ici.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="bouton" onClick={copier}>
            📋 Copier le prompt de vérification
          </button>
          {etat === "copie" && <span className="text-succes">Copié. Collez-le dans votre assistant.</span>}
        </div>
        {etat === "manuel" && (
          <textarea readOnly className="champ h-48 font-mono text-xs" value={texte} onFocus={(e) => e.target.select()} />
        )}
      </div>
    </details>
  );
}
