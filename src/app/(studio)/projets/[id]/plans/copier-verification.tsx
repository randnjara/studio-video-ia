"use client";

import { useState } from "react";

// Copie le prompt de vérification : la personne le colle dans un assistant gratuit (ChatGPT, Claude, Gemini…)
// Sert aussi pour le prompt de préparation du tableau des plans (titre, explication et bouton différents)
export function CopierVerification({
  texte,
  titre = "Vérifier le script et la continuité (gratuit)",
  explication = "Le bouton copie une consigne complète avec votre script et tous les plans. Collez-la dans un assistant gratuit (ChatGPT, Claude, Gemini…) et joignez les photos de départ dans l'ordre si possible. Il répond avec un tableau des plans à corriger et les consignes corrigées, prêtes à recopier ici.",
  bouton = "📋 Copier le prompt de vérification",
  carte = true,
}: {
  texte: string;
  titre?: string;
  explication?: string;
  bouton?: string;
  carte?: boolean;
}) {
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
    <details className={carte ? "carte text-sm" : "rounded-lg border border-ligne p-4 text-sm"}>
      <summary className="cursor-pointer font-semibold">{titre}</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-sourdine">{explication}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="bouton" onClick={copier}>
            {bouton}
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
