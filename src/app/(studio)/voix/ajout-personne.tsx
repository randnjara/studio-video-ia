"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AGES, GENRES, LANGUES_PERSONNE, nomLangue } from "@/lib/voix";
import { ajouterVoixPersonne } from "./actions";

const TAILLE_MAX = 20 * 1024 * 1024;

// Ajouter la voix d'une personne (avec son accord) : un enregistrement de 10 à 30 secondes suffit.
// Importé, ou enregistré directement avec le micro.
export function AjoutPersonne() {
  const [fichier, setFichier] = useState<File | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [enregistre, setEnregistre] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const micro = useRef<MediaRecorder | null>(null);
  const formulaire = useRef<HTMLFormElement>(null);

  function choisir(f: File | null) {
    if (apercu) URL.revokeObjectURL(apercu);
    setFichier(f);
    setApercu(f ? URL.createObjectURL(f) : null);
  }

  async function demarrerMicro() {
    setMessage(null);
    try {
      const flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true } });
      const morceaux: Blob[] = [];
      const rec = new MediaRecorder(flux);
      rec.ondataavailable = (e) => morceaux.push(e.data);
      rec.onstop = () => {
        flux.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType.split(";")[0] || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        choisir(new File(morceaux, `micro.${ext}`, { type }));
        setEnregistre(false);
      };
      rec.start();
      micro.current = rec;
      setEnregistre(true);
    } catch {
      setMessage({ ok: false, texte: "Le micro n'est pas accessible : autorisez-le dans le navigateur, ou importez un fichier." });
    }
  }

  async function envoyer(formData: FormData) {
    setMessage(null);
    if (!fichier) return setMessage({ ok: false, texte: "Importez ou enregistrez d'abord la voix." });
    if (fichier.size > TAILLE_MAX) return setMessage({ ok: false, texte: "Le fichier dépasse 20 Mo : 30 secondes suffisent." });
    if (!formData.get("accord")) return setMessage({ ok: false, texte: "Cochez la case : la personne doit être d'accord." });
    setEnvoi(true);
    try {
      const ext = (fichier.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
      const chemin = `voix/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient().storage.from("medias").upload(chemin, fichier, { contentType: fichier.type || "audio/mpeg" });
      if (error) throw new Error(error.message.toLowerCase().includes("policy") ? "Stockage refusé (migration 0014 à appliquer)." : error.message);
      const r = await ajouterVoixPersonne({
        nom: String(formData.get("nom") ?? ""),
        langue: String(formData.get("langue") ?? "mg"),
        genre: String(formData.get("genre") ?? "autre"),
        age: String(formData.get("age") ?? "adulte"),
        description: String(formData.get("description") ?? ""),
        accord: true,
        commercial: Boolean(formData.get("commercial")),
        chemin,
      });
      if (r.erreur) {
        await createClient().storage.from("medias").remove([chemin]);
        throw new Error(r.erreur);
      }
      setMessage({ ok: true, texte: "Voix ajoutée au catalogue. Elle est disponible dans le studio voix de chaque projet." });
      formulaire.current?.reset();
      choisir(null);
    } catch (e) {
      setMessage({ ok: false, texte: e instanceof Error ? e.message : "Ajout impossible." });
    }
    setEnvoi(false);
  }

  return (
    <section id="personne" className="carte flex scroll-mt-24 flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold">➕ Ajouter la voix d&apos;une personne</h2>
        <p className="text-sm text-sourdine">
          Une personne que vous connaissez et qui est d&apos;accord (vous, une grand-mère, un comédien…). Il suffit de{" "}
          <b>10 à 30 secondes</b> de parole claire : pièce calme, sans musique ni écho, téléphone posé à 20 cm de la bouche,
          ton naturel comme pour raconter une histoire. Le studio copie le timbre de sa voix : en malgache, le texte est dit
          par la voix MMS puis transformé avec cette voix ; dans les 23 langues de Chatterbox (français, anglais…), il est dit
          directement avec sa voix.
        </p>
      </div>
      <form ref={formulaire} action={envoyer} className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="p-nom" className="etiquette">
            Nom de la voix
          </label>
          <input id="p-nom" name="nom" required placeholder="Ex. : Bebe Rasoa" className="champ" />
        </div>
        <div>
          <label htmlFor="p-langue" className="etiquette">
            Langue parlée
          </label>
          <select id="p-langue" name="langue" defaultValue="mg" className="champ">
            {LANGUES_PERSONNE.map((l) => (
              <option key={l} value={l}>
                {nomLangue(l)}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="p-genre" className="etiquette">
              Genre
            </label>
            <select id="p-genre" name="genre" defaultValue="femme" className="champ">
              {Object.entries(GENRES).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="p-age" className="etiquette">
              Âge
            </label>
            <select id="p-age" name="age" defaultValue="adulte" className="champ">
              {Object.entries(AGES).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="p-desc" className="etiquette">
            Note (facultatif)
          </label>
          <input id="p-desc" name="description" placeholder="Ex. : voix douce, accent du Sud" className="champ" />
        </div>

        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <label className="bouton-discret cursor-pointer">
            ⬆ Importer un enregistrement
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" className="hidden" onChange={(e) => choisir(e.target.files?.[0] ?? null)} />
          </label>
          {enregistre ? (
            <button type="button" className="bouton-danger" onClick={() => micro.current?.stop()}>
              ⏹ Arrêter l&apos;enregistrement
            </button>
          ) : (
            <button type="button" className="bouton-discret" onClick={() => void demarrerMicro()}>
              🎤 Enregistrer avec le micro
            </button>
          )}
          {enregistre && <span className="animate-pulse text-sm text-alerte">● Enregistrement en cours…</span>}
          {apercu && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio src={apercu} controls className="min-w-60 flex-1" />
          )}
        </div>

        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="accord" className="mt-1 accent-[var(--accent)]" />
          <span>
            <b>Cette personne est d&apos;accord</b> pour que sa voix soit copiée et utilisée dans nos vidéos.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input type="checkbox" name="commercial" className="mt-1 accent-[var(--accent)]" />
          <span>
            Elle accepte aussi un <b>usage commercial</b> (vidéos vendues ou monétisées). Sinon, la voix sera marquée ⚠ non
            commercial. En malgache, la voix de base MMS reste de toute façon non commerciale.
          </span>
        </label>
        <div className="md:col-span-2">
          <button type="submit" className="bouton" disabled={envoi || enregistre}>
            {envoi ? "Envoi…" : "Ajouter cette voix"}
          </button>
        </div>
        {message && <p className={`md:col-span-2 ${message.ok ? "message-ok" : "message-erreur"}`}>{message.texte}</p>}
      </form>
    </section>
  );
}
