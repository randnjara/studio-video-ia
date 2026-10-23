"use client";

import { useState } from "react";

// Un bouton par lot de 10 photos : la personne colle chaque lot dans ChatGPT, l'un après l'autre
export function CopierLots({ lots }: { lots: { debut: number; fin: number; texte: string }[] }) {
  const [copies, setCopies] = useState<Set<number>>(new Set());
  const [manuel, setManuel] = useState<string | null>(null);

  async function copier(i: number) {
    try {
      await navigator.clipboard.writeText(lots[i].texte);
      setManuel(null);
    } catch {
      setManuel(lots[i].texte);
    }
    setCopies((c) => new Set(c).add(i));
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-semibold">1. Copier les prompts des photos, lot par lot</p>
      <p className="text-sourdine">
        Ouvrez une nouvelle discussion ChatGPT, joignez les photos de référence citées, puis collez le lot 1. ChatGPT crée
        les 10 photos et vous donne un fichier ZIP à télécharger. Continuez dans la même discussion avec le lot 2, et ainsi
        de suite.
      </p>
      <div className="flex flex-wrap gap-2">
        {lots.map((l, i) => (
          <button key={l.debut} type="button" className={copies.has(i) ? "bouton-discret" : "bouton"} onClick={() => copier(i)}>
            {copies.has(i) ? "✓ " : "📋 "}Lot {i + 1} : plans {l.debut} à {l.fin}
          </button>
        ))}
      </div>
      {copies.size > 0 && !manuel && <p className="text-succes">Copié. Collez-le dans ChatGPT.</p>}
      {manuel && (
        <textarea readOnly className="champ h-48 font-mono text-xs" value={manuel} onFocus={(e) => e.target.select()} />
      )}
    </div>
  );
}
