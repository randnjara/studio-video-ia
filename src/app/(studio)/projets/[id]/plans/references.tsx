"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { envoyerPhoto } from "@/lib/envoi-photo";
import { GENRES } from "@/lib/libelles";
import { ajouterReference } from "./actions";

// Ajout d'une référence du film : la photo part directement dans le stockage, puis la référence est enregistrée.
// Avec « produit », le genre est fixé (section du produit à promouvoir) et le nom est proposé d'après les photos déjà là.
export function AjoutReference({ projectId, produit }: { projectId: string; produit?: string }) {
  const [apercu, setApercu] = useState<string>();
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();

  function envoyer(formData: FormData) {
    setErreur(null);
    demarrer(async () => {
      try {
        const fichier = formData.get("photo");
        formData.delete("photo");
        if (!(fichier instanceof File) || fichier.size === 0) throw new Error("Choisissez une photo de référence.");
        formData.set("image_path", await envoyerPhoto(projectId, fichier));
        await ajouterReference(projectId, formData);
      } catch (e) {
        unstable_rethrow(e);
        setErreur(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <form action={envoyer} className="grid gap-3 sm:grid-cols-[140px_1fr]">
      <label className="block cursor-pointer">
        {apercu ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={apercu} alt="Référence" className="aspect-square w-full rounded-lg border border-ligne object-cover" />
        ) : (
          <span className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-ligne text-center text-sm text-sourdine hover:border-accent">
            📷 Photo
          </span>
        )}
        <input
          name="photo"
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setApercu(URL.createObjectURL(f));
          }}
        />
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            name="nom"
            required
            maxLength={60}
            defaultValue={produit ?? ""}
            placeholder={produit === undefined ? "Nom cité dans les plans (ex. : Rova)" : "Nom exact du produit (ex. : Réchaud IH-2200W)"}
            className="champ min-w-0 flex-1 text-sm"
          />
          {produit === undefined ? (
            <select name="genre" aria-label="Genre" className="champ w-auto text-sm" defaultValue="personnage">
              {Object.entries(GENRES)
                .filter(([v]) => v !== "produit")
                .map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
            </select>
          ) : (
            <input type="hidden" name="genre" value="produit" />
          )}
        </div>
        <input
          name="description"
          maxLength={300}
          placeholder={
            produit === undefined
              ? "Détails à garder, facultatif (ex. : femme de 30 ans, robe rouge, cheveux tressés)"
              : "Vue de la photo et détails, facultatif (ex. : vue de face, plaque noire, écran bleu)"
          }
          className="champ text-sm"
        />
        {erreur && <p className="message-erreur">{erreur}</p>}
        <div>
          <button type="submit" className="bouton-discret" disabled={enCours}>
            {enCours && <Roue />}
            {enCours ? "Envoi…" : "＋ Ajouter la référence"}
          </button>
        </div>
      </div>
    </form>
  );
}
