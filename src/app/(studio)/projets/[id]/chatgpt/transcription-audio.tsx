"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FriseTravail } from "@/components/frise-travail";
import { ImportVoixOff } from "../plans/import-voix-off";
import { lancerTranscription, suivreTranscription } from "../plans/voix-off-actions";

type Creation = { id: string; nom: string; duree: number | null };

// Nouveau projet sans tableau : la voix off audio est transcrite (Whisper) en répliques horodatées de 5 s au plus, avec le
// ton lu dans l'audio. La transcription entre dans la consigne de l'assistant : le tableau importé aura déjà le bon
// minutage, et l'intention et les gestes suivront l'émotion réelle de la voix. Whisper n'écrit aucun prompt.
export function TranscriptionAudio({
  projectId,
  creations,
  transcrite,
}: {
  projectId: string;
  creations: Creation[];
  transcrite: { nom: string; repliques: number } | null;
}) {
  const router = useRouter();
  const [creation, setCreation] = useState(creations[0]?.id ?? "");
  const [langue, setLangue] = useState("mg");
  const [etat, setEtat] = useState<{ enCours: boolean; message: string; erreur?: boolean }>({ enCours: false, message: "" });
  const [job, setJob] = useState<string | null>(null);

  async function transcrire(id = creation) {
    if (!id || etat.enCours) return;
    setEtat({ enCours: true, message: "" });
    const r: Awaited<ReturnType<typeof lancerTranscription>> = await lancerTranscription(projectId, id, langue).catch(() => ({
      erreur: "Connexion perdue.",
    }));
    if ("erreur" in r) return setEtat({ enCours: false, message: r.erreur, erreur: true });
    setJob(r.jobId);
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 4000));
      const s: Awaited<ReturnType<typeof suivreTranscription>> = await suivreTranscription(projectId, id, r.jobId).catch(() => ({
        etat: "en_cours" as const,
      }));
      if ("erreur" in s) return setEtat({ enCours: false, message: s.erreur ?? "Échec.", erreur: true });
      if (s.etat === "terminee") {
        setEtat({ enCours: false, message: `${s.repliques} répliques horodatées avec leur ton : elles sont dans la consigne ci-dessous.` });
        router.refresh();
        return;
      }
    }
  }

  return (
    <section className="carte flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">🎧 Préparer le tableau depuis l&apos;audio</h2>
        <p className="text-sm text-sourdine">
          Vous avez déjà la voix off en audio (ElevenLabs, micro…) ? Elle devient la référence : Whisper la transcrit en répliques
          de 5 s au plus, coupées aux pauses et aux fins de phrases, avec le ton entendu (calme, joyeux, ému, rieur, interrogatif).
          La consigne de l&apos;assistant les reprend : le tableau importé aura déjà le bon minutage, et les intentions et gestes
          suivront l&apos;émotion réelle de la voix.
        </p>
      </div>
      <ImportVoixOff
        projectId={projectId}
        onImportee={(id) => {
          setCreation(id);
          void transcrire(id);
        }}
      />
      {creations.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="etiquette mb-0">Voix off</span>
            <select className="champ" value={creation} onChange={(e) => setCreation(e.target.value)} disabled={etat.enCours}>
              {creations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom || "Voix"}
                  {c.duree ? ` · ${c.duree.toFixed(1)} s` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="etiquette mb-0">Langue parlée</span>
            <select className="champ" value={langue} onChange={(e) => setLangue(e.target.value)} disabled={etat.enCours}>
              <option value="mg">Malgache</option>
              <option value="fr">Français</option>
              <option value="en">Anglais</option>
              <option value="">Détection automatique</option>
            </select>
          </label>
          <button type="button" className="bouton" disabled={etat.enCours} onClick={() => void transcrire()}>
            Préparer le tableau depuis l&apos;audio
          </button>
        </div>
      )}
      {transcrite && !etat.message && (
        <p className="message-ok">
          Transcription de « {transcrite.nom || "la voix off"} » prête ({transcrite.repliques} répliques) : elle est dans la consigne.
        </p>
      )}
      {etat.message && <p className={etat.erreur ? "message-erreur" : etat.enCours ? "text-sm" : "message-ok"}>{etat.message}</p>}
      {job && (
        <div className="rounded-lg border border-ligne p-2">
          <FriseTravail jobId={job} />
        </div>
      )}
    </section>
  );
}
