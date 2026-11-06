"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACCEPTE, TAILLE_MAX, encoderWav, frequencePourTaille, typeAudio } from "@/lib/voix-off-import";
import { enregistrerVoixImportee } from "./voix-off-actions";

// Lit le son dans le navigateur : sa durée exacte, et un WAV mono plus léger s'il dépasse la limite du stockage (50 Mo)
async function preparer(fichier: File): Promise<{ contenu: Blob; type: string; duree: number; ext: string }> {
  const type = typeAudio(fichier.name, fichier.type);
  if (!type) throw new Error(`« ${fichier.name} » n'est pas un fichier son accepté (MP3, WAV, M4A, OGG).`);
  const ctx = new AudioContext();
  let son: AudioBuffer;
  try {
    son = await ctx.decodeAudioData(await fichier.arrayBuffer());
  } catch {
    throw new Error(`Le navigateur ne sait pas lire « ${fichier.name} ». Essayez en MP3 ou en WAV.`);
  } finally {
    void ctx.close();
  }
  const ext = (fichier.name.split(".").pop() || "mp3").toLowerCase();
  if (fichier.size <= TAILLE_MAX) return { contenu: fichier, type, duree: son.duration, ext };
  // Trop gros (souvent un WAV stéréo de plusieurs minutes) : WAV mono, à une fréquence qui tient sous 50 Mo
  const frequence = frequencePourTaille(son.duration, son.sampleRate);
  if (!frequence) throw new Error("Voix off trop longue pour le stockage (50 Mo) : coupez-la en morceaux ou envoyez-la en MP3.");
  const hors = new OfflineAudioContext(1, Math.ceil(son.duration * frequence), frequence);
  const source = hors.createBufferSource();
  source.buffer = son;
  source.connect(hors.destination);
  source.start();
  const rendu = await hors.startRendering();
  return { contenu: new Blob([encoderWav([rendu.getChannelData(0)], frequence)], { type: "audio/wav" }), type: "audio/wav", duree: son.duration, ext: "wav" };
}

// « ⬆ Importer la voix off audio » : bouton ou glisser-déposer. La voix est rangée comme une voix terminée du projet.
export function ImportVoixOff({ projectId, onImportee }: { projectId: string; onImportee: (id: string) => void }) {
  const champ = useRef<HTMLInputElement>(null);
  const [survol, setSurvol] = useState(false);
  const [etat, setEtat] = useState<{ enCours: boolean; message: string; erreur?: boolean }>({ enCours: false, message: "" });

  async function importer(fichier: File | undefined) {
    if (!fichier || etat.enCours) return;
    setEtat({ enCours: true, message: `Lecture de « ${fichier.name} »…` });
    try {
      const { contenu, type, duree, ext } = await preparer(fichier);
      setEtat({ enCours: true, message: `Envoi de « ${fichier.name} » (${duree.toFixed(1)} s)…` });
      const chemin = `${projectId}/voix/voix-off-${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient().storage.from("medias").upload(chemin, contenu, { contentType: type });
      if (error) throw new Error(`Envoi impossible : ${error.message}`);
      const r = await enregistrerVoixImportee(projectId, { chemin, nom: fichier.name, duree });
      if ("erreur" in r) throw new Error(r.erreur);
      setEtat({ enCours: false, message: `Voix off « ${fichier.name} » importée (${duree.toFixed(1)} s).` });
      onImportee(r.id);
    } catch (e) {
      setEtat({ enCours: false, message: e instanceof Error ? e.message : "Import impossible.", erreur: true });
    }
    if (champ.current) champ.current.value = "";
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm ${survol ? "border-accent bg-accent-doux" : "border-ligne"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setSurvol(true);
      }}
      onDragLeave={() => setSurvol(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSurvol(false);
        void importer(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="bouton-discret" disabled={etat.enCours} onClick={() => champ.current?.click()}>
          ⬆ Importer la voix off audio
        </button>
        <span className="text-xs text-sourdine">
          Votre voix off finale (ElevenLabs, micro…) en MP3, WAV, M4A ou OGG, ou glissez le fichier ici. Elle doit suivre le texte
          des plans.
        </span>
        <input ref={champ} type="file" accept={ACCEPTE} className="hidden" onChange={(e) => void importer(e.target.files?.[0])} />
      </div>
      {etat.message && <p className={etat.erreur ? "message-erreur" : etat.enCours ? "text-sm" : "message-ok"}>{etat.message}</p>}
    </div>
  );
}
