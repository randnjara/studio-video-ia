"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Roue } from "@/components/bouton-envoi";

// Barre d'envoi à la génération : compte les plans cochés et donne le coût estimé avant d'envoyer.
export function BarreSelection({ prixParPlan, prets }: { prixParPlan: number; prets: number }) {
  const [coches, setCoches] = useState(0);
  const { pending } = useFormStatus();

  useEffect(() => {
    const cases = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[form="selection"][name="plans"]'));
    const compter = () => setCoches(cases().filter((c) => c.checked).length);
    document.addEventListener("change", compter);
    compter();
    return () => document.removeEventListener("change", compter);
  }, []);

  function toutCocher(valeur: boolean) {
    document
      .querySelectorAll<HTMLInputElement>('input[form="selection"][name="plans"]:not(:disabled)')
      .forEach((c) => (c.checked = valeur));
    document.dispatchEvent(new Event("change"));
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">Envoyer à la génération vidéo</p>
        <p className="text-sourdine">
          Cochez les plans à transformer en clips, ou envoyez d'un coup tous ceux qui n'ont pas encore de vidéo.
        </p>
      </div>
      <button type="button" className="bouton-discret px-3 py-1.5 text-sm" onClick={() => toutCocher(coches === 0)}>
        {coches === 0 ? "Tout cocher" : "Tout décocher"}
      </button>
      <button
        type="submit"
        className="bouton"
        disabled={pending || coches === 0}
        onClick={(e) => {
          if (!window.confirm(`Générer ${coches} clip${coches > 1 ? "s" : ""} pour environ ${(coches * prixParPlan).toFixed(2)} $ ?`))
            e.preventDefault();
        }}
      >
        {pending && <Roue />}
        {pending ? "Envoi…" : `▶ Envoyer la sélection (${coches}) ≈ ${(coches * prixParPlan).toFixed(2)} $`}
      </button>
      {prets > 0 && (
        <button
          type="submit"
          name="tous"
          value="1"
          className="bouton-discret"
          disabled={pending}
          onClick={(e) => {
            if (!window.confirm(`Générer ${prets} clip${prets > 1 ? "s" : ""} pour environ ${(prets * prixParPlan).toFixed(2)} $ ?`))
              e.preventDefault();
          }}
        >
          Tous les nouveaux ({prets})
        </button>
      )}
    </div>
  );
}
