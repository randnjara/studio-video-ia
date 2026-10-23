"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Roue } from "@/components/bouton-envoi";

// Barre d'envoi à la génération : compte les plans cochés et donne le coût estimé avant d'envoyer.
type ChoixMoteur = { id: string; libelle: string; prix5s: number };

export function BarreSelection({
  moteurs,
  prets,
  supprimer,
  creerPhotos,
  prixPhoto,
}: {
  moteurs: ChoixMoteur[];
  prets: number;
  supprimer: (formData: FormData) => void | Promise<void>;
  // Absent tant que notre serveur RunPod n'existe pas
  creerPhotos?: (formData: FormData) => void | Promise<void>;
  prixPhoto: number;
}) {
  const [coches, setCoches] = useState(0);
  const [pretsCoches, setPretsCoches] = useState(0);
  const [decrits, setDecrits] = useState(0);
  const [moteur, setMoteur] = useState(moteurs[0]);
  const prixParPlan = moteur.prix5s;
  const { pending } = useFormStatus();

  useEffect(() => {
    const cases = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[form="selection"][name="plans"]'));
    const compter = () => {
      const cochees = cases().filter((c) => c.checked);
      setCoches(cochees.length);
      setPretsCoches(cochees.filter((c) => c.dataset.pret === "1").length);
      setDecrits(cochees.filter((c) => c.dataset.description === "1").length);
    };
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
      {moteurs.length > 1 ? (
        <select
          name="moteur"
          aria-label="Moteur de génération"
          className="champ w-auto text-sm"
          value={moteur.id}
          onChange={(e) => setMoteur(moteurs.find((m) => m.id === e.target.value) ?? moteurs[0])}
        >
          {moteurs.map((m) => (
            <option key={m.id} value={m.id}>
              {m.libelle} · ≈ {m.prix5s.toFixed(2)} $ / clip
            </option>
          ))}
        </select>
      ) : (
        <input type="hidden" name="moteur" value={moteur.id} />
      )}
      <button type="button" className="bouton-discret px-3 py-1.5 text-sm" onClick={() => toutCocher(coches === 0)}>
        {coches === 0 ? "Tout cocher" : "Tout décocher"}
      </button>
      <button
        type="submit"
        className="bouton"
        disabled={pending || pretsCoches === 0}
        title={coches > pretsCoches ? "Les plans sans photo, mouvement ou accord ne partent pas" : undefined}
        onClick={(e) => {
          if (
            !window.confirm(
              `Générer ${pretsCoches} clip${pretsCoches > 1 ? "s" : ""} pour environ ${(pretsCoches * prixParPlan).toFixed(2)} $ ?`,
            )
          )
            e.preventDefault();
        }}
      >
        {pending && <Roue />}
        {pending ? "Envoi…" : `▶ Envoyer la sélection (${pretsCoches}) ≈ ${(pretsCoches * prixParPlan).toFixed(2)} $`}
      </button>
      {creerPhotos && (
        <button
          type="submit"
          formAction={creerPhotos}
          className="bouton-discret"
          disabled={pending || decrits === 0}
          title="Crée les photos de départ des plans cochés qui ont une description, à partir des références du film"
          onClick={(e) => {
            const texte = `Créer ${decrits} photo${decrits > 1 ? "s" : ""} de départ pour environ ${(decrits * prixPhoto).toFixed(2)} $ ? Les photos actuelles de ces plans seront remplacées.`;
            if (!window.confirm(texte)) e.preventDefault();
          }}
        >
          🖼 Créer les photos ({decrits}) ≈ {(decrits * prixPhoto).toFixed(2)} $
        </button>
      )}
      <button
        type="submit"
        formAction={supprimer}
        className="bouton-danger"
        disabled={pending || coches === 0}
        onClick={(e) => {
          if (
            !window.confirm(
              `Supprimer ${coches} plan${coches > 1 ? "s" : ""} et leurs clips ? Cette action est définitive.`,
            )
          )
            e.preventDefault();
        }}
      >
        Supprimer la sélection ({coches})
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
