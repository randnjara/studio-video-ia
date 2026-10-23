"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";
import { Roue } from "@/components/bouton-envoi";
import { envoyerPhoto } from "@/lib/envoi-photo";
import { ajouterPlan, modifierPlan } from "./actions";

type PlanExistant = {
  id: string;
  motion_prompt: string;
  voiceover_text: string;
  image_description: string;
  consent_confirmed: boolean;
};

// Formulaire d'un plan : la photo part directement dans le stockage, puis le plan est enregistré.
export function FormulairePlan({
  projectId,
  plan,
  photoUrl,
}: {
  projectId: string;
  plan?: PlanExistant;
  photoUrl?: string;
}) {
  const [apercu, setApercu] = useState<string | undefined>(photoUrl);
  const [erreur, setErreur] = useState<string | null>(null);
  const [etape, setEtape] = useState<string | null>(null);
  const [enCours, demarrer] = useTransition();
  const suffixe = plan?.id ?? "nouveau";

  function envoyer(formData: FormData) {
    setErreur(null);
    demarrer(async () => {
      try {
        const fichier = formData.get("photo");
        formData.delete("photo");
        if (fichier instanceof File && fichier.size > 0) {
          setEtape("Envoi de la photo…");
          formData.set("image_path", await envoyerPhoto(projectId, fichier));
        }
        setEtape("Enregistrement…");
        if (plan) await modifierPlan(projectId, plan.id, formData);
        else await ajouterPlan(projectId, formData);
      } catch (e) {
        // La redirection de fin d'enregistrement passe aussi par ici : on la laisse continuer
        unstable_rethrow(e);
        setErreur(e instanceof Error ? e.message : String(e));
      } finally {
        setEtape(null);
      }
    });
  }

  return (
    <form action={envoyer} className="grid gap-4 sm:grid-cols-[220px_1fr]">
      <div className="flex flex-col gap-2">
        <label htmlFor={`photo-${suffixe}`} className="block cursor-pointer">
          {apercu ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={apercu} alt="Photo du plan" className="aspect-video w-full rounded-lg border border-ligne object-cover" />
          ) : (
            <span className="flex aspect-video items-center justify-center rounded-lg border-2 border-dashed border-ligne text-center text-sm text-sourdine hover:border-accent">
              📷 Choisir une photo
            </span>
          )}
        </label>
        <input
          id={`photo-${suffixe}`}
          name="photo"
          type="file"
          accept="image/*"
          className="text-xs text-sourdine file:mr-2 file:rounded-md file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-encre"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) setApercu(URL.createObjectURL(f));
          }}
        />
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <label className="etiquette" htmlFor={`desc-${suffixe}`}>
            Description de la photo de départ (sans photo, elle sera créée à partir des références du film)
          </label>
          <textarea
            id={`desc-${suffixe}`}
            name="image_description"
            rows={2}
            defaultValue={plan?.image_description}
            placeholder="Citez les noms des références. Ex. : plan large, Rova marche seule sur la Plage au coucher du soleil, vue de dos"
            className="champ text-sm"
          />
        </div>
        <div>
          <label className="etiquette" htmlFor={`motion-${suffixe}`}>
            Mouvement voulu (en anglais de préférence)
          </label>
          <textarea
            id={`motion-${suffixe}`}
            name="motion_prompt"
            rows={3}
            defaultValue={plan?.motion_prompt}
            placeholder="Ex. : slow zoom in, the woman smiles and turns her head toward the camera, soft morning light"
            className="champ text-sm"
          />
        </div>
        <div>
          <label className="etiquette" htmlFor={`voix-${suffixe}`}>
            Texte de la voix off sur ce plan
          </label>
          <textarea
            id={`voix-${suffixe}`}
            name="voiceover_text"
            rows={2}
            defaultValue={plan?.voiceover_text}
            className="champ text-sm"
          />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent_confirmed" defaultChecked={plan?.consent_confirmed ?? true} className="mt-1" />
          Les personnes visibles sur la photo sont d'accord pour être animées en vidéo.
        </label>
        {erreur && <p className="message-erreur">{erreur}</p>}
        <div>
          <button type="submit" className={plan ? "bouton-discret" : "bouton"} disabled={enCours}>
            {enCours && <Roue />}
            {enCours ? (etape ?? "Un instant…") : plan ? "Enregistrer le plan" : "Ajouter le plan"}
          </button>
        </div>
      </div>
    </form>
  );
}
