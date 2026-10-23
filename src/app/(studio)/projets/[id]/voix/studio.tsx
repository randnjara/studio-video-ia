"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AGES, GENRES, type Voix, avecEmotion, nomLangue } from "@/lib/voix";
import { actualiserVoix, creerVoix, importerEnregistrement, supprimerCreation } from "./actions";
import { ConsoleMixage } from "./console-mixage";

export type CreationAffichee = {
  id: string;
  voixId: string | null;
  nom: string;
  texte: string;
  transformee: boolean;
  status: "en_cours" | "terminee" | "echouee";
  emotion: number;
  reglages: Record<string, unknown>;
  urlAudio: string | null;
  urlMixage: string | null;
  duree: number | null;
  cout: number | null;
  erreur: string | null;
};

const TAILLE_MAX = 50 * 1024 * 1024;

// Libellé d'une voix dans les listes : nom, genre, âge, et l'avertissement « non commercial »
const libelle = (v: Voix) =>
  `${v.nom} · ${GENRES[v.genre]}${v.age !== "adulte" ? ` · ${AGES[v.age]}` : ""}${v.usage_commercial ? "" : " · ⚠ non commercial"}`;

// Les voix rangées par langue, le malgache d'abord
function parLangue(voix: Voix[]) {
  const groupes = new Map<string, Voix[]>();
  for (const v of voix) groupes.set(v.langue, [...(groupes.get(v.langue) ?? []), v]);
  return [...groupes.entries()].sort(([a], [b]) => (a === "mg" ? -1 : b === "mg" ? 1 : nomLangue(a).localeCompare(nomLangue(b))));
}

function ChoixVoix({ voix, valeur, onChange, id }: { voix: Voix[]; valeur: string; onChange: (v: string) => void; id: string }) {
  return (
    <select id={id} value={valeur} onChange={(e) => onChange(e.target.value)} className="champ">
      {parLangue(voix).map(([langue, liste]) => (
        <optgroup key={langue} label={nomLangue(langue)}>
          {liste.map((v) => (
            <option key={v.id} value={v.id}>
              {libelle(v)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function mesurer(f: File): Promise<number | null> {
  return new Promise((ok) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(f);
    el.preload = "metadata";
    el.onloadedmetadata = () => (URL.revokeObjectURL(url), ok(Number.isFinite(el.duration) ? el.duration : null));
    el.onerror = () => (URL.revokeObjectURL(url), ok(null));
    el.src = url;
  });
}

export function Studio({
  projectId,
  voix,
  creations,
  plans,
  serveurPret,
}: {
  projectId: string;
  voix: Voix[];
  creations: CreationAffichee[];
  plans: { numero: number; texte: string }[];
  serveurPret: boolean;
}) {
  const router = useRouter();
  const malgache = voix.find((v) => v.langue === "mg") ?? voix[0];
  const [voixId, setVoixId] = useState(malgache?.id ?? "");
  const [texte, setTexte] = useState("");
  const [nom, setNom] = useState("");
  const [emotion, setEmotion] = useState(0.5);
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [cibleImport, setCibleImport] = useState("");

  const choisie = voix.find((v) => v.id === voixId);
  const personnes = useMemo(() => voix.filter((v) => v.reference_path), [voix]);
  const enCours = creations.filter((c) => c.status === "en_cours").length;
  const piste = creations.find((c) => c.id === ouverte && c.status === "terminee");

  // Tant qu'une voix est en calcul, demande des nouvelles toutes les 4 secondes
  useEffect(() => {
    if (enCours === 0) return;
    let actif = true;
    const boucle = setInterval(async () => {
      const restants = await actualiserVoix(projectId).catch(() => enCours);
      if (actif && restants !== enCours) router.refresh();
    }, 4000);
    return () => {
      actif = false;
      clearInterval(boucle);
    };
  }, [enCours, projectId, router]);

  async function generer(p: { voixId: string; texte: string; emotion: number; nom: string }) {
    setErreur(null);
    setEnvoi("Envoi au serveur voix…");
    const r = await creerVoix(projectId, p).catch(() => ({ erreur: "Connexion perdue, réessayez." }));
    if (r.erreur) setErreur(r.erreur);
    setEnvoi(null);
    router.refresh();
  }

  async function importer(f: File | undefined) {
    if (!f) return;
    setErreur(null);
    if (!f.type.startsWith("audio/") && !/\.(mp3|m4a|wav|aac|ogg|webm)$/i.test(f.name)) return setErreur("Choisissez un fichier son (MP3, M4A, WAV…).");
    if (f.size > TAILLE_MAX) return setErreur("Le fichier dépasse 50 Mo.");
    setEnvoi(`Envoi de « ${f.name} »…`);
    try {
      const ext = (f.name.split(".").pop() || "mp3").toLowerCase();
      const chemin = `${projectId}/voix/source-${crypto.randomUUID()}.${ext}`;
      const [duree, { error }] = await Promise.all([
        mesurer(f),
        createClient().storage.from("medias").upload(chemin, f, { contentType: f.type || "audio/mpeg" }),
      ]);
      if (error) throw new Error(error.message);
      const r = await importerEnregistrement(projectId, {
        chemin,
        nom: f.name.replace(/\.[^.]+$/, ""),
        duree,
        voixId: cibleImport || null,
      });
      if (r.erreur) throw new Error(r.erreur);
      router.refresh();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "Envoi impossible.");
    }
    setEnvoi(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {!serveurPret && (
        <p className="message-erreur">
          Le serveur voix n&apos;est pas encore créé. Le responsable le crée en un clic dans{" "}
          <Link href="/equipe#voix" className="lien">
            Équipe et budget
          </Link>
          . En attendant, vous pouvez importer un enregistrement et le passer dans la table de mixage.
        </p>
      )}

      {/* 1. Texte → voix */}
      <section className="carte flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">🗣 Faire dire un texte</h2>
          <p className="text-sm text-sourdine">
            Choisissez une voix, écrivez le texte (ou reprenez la voix off d&apos;un plan), puis « Créer la voix ». Comptez 10 à
            60 secondes, et moins d&apos;un centime par minute de voix. Les voix se gèrent dans{" "}
            <Link href="/voix" className="lien">
              Voix
            </Link>
            .
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label htmlFor="voix" className="etiquette">
              Voix
            </label>
            <ChoixVoix id="voix" voix={voix} valeur={voixId} onChange={setVoixId} />
            {choisie && (
              <p className="mt-1 text-xs text-sourdine">
                {choisie.description}
                {!choisie.usage_commercial && " Usage non commercial seulement."}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="nom-voix" className="etiquette">
              Nom (facultatif)
            </label>
            <input id="nom-voix" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. : Plan 3, grand-mère" className="champ" />
          </div>
        </div>
        {plans.some((p) => p.texte) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-sourdine">Reprendre la voix off :</span>
            <select
              className="champ w-auto py-1 text-sm"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "tous") setTexte(plans.map((p) => p.texte).filter(Boolean).join("\n"));
                else {
                  const plan = plans.find((p) => String(p.numero) === v);
                  if (plan) (setTexte(plan.texte), setNom(`Plan ${plan.numero}`));
                }
              }}
            >
              <option value="">Choisir un plan…</option>
              <option value="tous">Tous les plans à la suite</option>
              {plans
                .filter((p) => p.texte)
                .map((p) => (
                  <option key={p.numero} value={p.numero}>
                    Plan {p.numero} : {p.texte.slice(0, 50)}
                  </option>
                ))}
            </select>
          </div>
        )}
        <textarea
          value={texte}
          onChange={(e) => setTexte(e.target.value)}
          rows={4}
          maxLength={5000}
          placeholder="Manao ahoana daholo e! Tongasoa eto amin'ny…"
          className="champ"
          aria-label="Texte à dire"
        />
        {choisie && avecEmotion(choisie) && (
          <label className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">Émotion</span>
            <span className="text-xs text-sourdine">calme</span>
            <input type="range" min={0.25} max={1.5} step={0.05} value={emotion} onChange={(e) => setEmotion(Number(e.target.value))} className="w-48" />
            <span className="text-xs text-sourdine">très expressive</span>
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="bouton"
            disabled={Boolean(envoi) || !texte.trim() || !voixId || !serveurPret}
            onClick={() => void generer({ voixId, texte, emotion, nom })}
          >
            {envoi ?? "🎙 Créer la voix"}
          </button>
          <span className="text-xs text-sourdine">{texte.length} / 5000 caractères</span>
        </div>
      </section>

      {/* 2. Enregistrement importé */}
      <section className="carte flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-bold">🎤 Transformer un enregistrement</h2>
          <p className="text-sm text-sourdine">
            Importez une voix enregistrée (téléphone, micro). Gardez-la telle quelle pour la passer dans la table de mixage
            (âge, vitesse, effets), ou donnez-lui la voix d&apos;une personne du catalogue : les mots et l&apos;intonation restent,
            seul le timbre change.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <label htmlFor="cible" className="etiquette">
              Voix à lui donner
            </label>
            <select id="cible" value={cibleImport} onChange={(e) => setCibleImport(e.target.value)} className="champ">
              <option value="">Garder sa voix (table de mixage seulement, gratuit)</option>
              {personnes.map((v) => (
                <option key={v.id} value={v.id} disabled={!serveurPret}>
                  {libelle(v)}
                </option>
              ))}
            </select>
            {personnes.length === 0 && (
              <p className="mt-1 text-xs text-sourdine">
                Pour donner la voix d&apos;une personne, ajoutez-la d&apos;abord dans{" "}
                <Link href="/voix#personne" className="lien">
                  Voix → Ajouter la voix d&apos;une personne
                </Link>
                .
              </p>
            )}
          </div>
          <label className="bouton-discret cursor-pointer">
            {envoi ?? "⬆ Importer un son"}
            <input
              type="file"
              accept="audio/*,.mp3,.m4a,.wav,.ogg"
              className="hidden"
              disabled={Boolean(envoi)}
              onChange={(e) => (void importer(e.target.files?.[0]), (e.target.value = ""))}
            />
          </label>
        </div>
      </section>

      {erreur && <p className="message-erreur">{erreur}</p>}

      {/* 3. Les voix du projet */}
      <section className="carte flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">Voix du projet ({creations.length})</h2>
          <p className="text-sm text-sourdine">
            Ouvrez une voix dans la table de mixage, réglez-la en écoutant, puis « Enregistrer pour le montage » : elle apparaît
            dans le montage (Médias → Voix), prête à poser sur la piste voix off.
          </p>
        </div>
        {creations.length === 0 ? (
          <p className="text-sm text-sourdine">Aucune voix pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {creations.map((c) => (
              <li key={c.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${ouverte === c.id ? "border-accent" : "border-ligne"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <b className="truncate">{c.nom || "Voix"}</b>
                  {c.status === "en_cours" && (
                    <span className="pastille bg-accent-doux text-accent">
                      <span className="mr-1 inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent align-middle" />
                      En création
                    </span>
                  )}
                  {c.status === "echouee" && <span className="pastille bg-alerte-doux text-alerte">Échec</span>}
                  {c.urlMixage && <span className="pastille bg-succes-doux text-succes">Mixée</span>}
                  {c.transformee && <span className="pastille bg-surface-2 text-sourdine">Enregistrement</span>}
                  <span className="text-xs text-sourdine">
                    {c.duree ? `${c.duree.toFixed(1)} s` : ""}
                    {c.cout ? ` · ${c.cout.toFixed(3)} $` : ""}
                  </span>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {c.status === "terminee" && (
                      <button type="button" className="bouton-discret px-3 py-1 text-sm" onClick={() => setOuverte(ouverte === c.id ? null : c.id)}>
                        {ouverte === c.id ? "Fermer la table" : "🎚 Table de mixage"}
                      </button>
                    )}
                    {c.texte && c.voixId && serveurPret && c.status !== "en_cours" && (
                      <button
                        type="button"
                        className="bouton-discret px-3 py-1 text-sm"
                        disabled={Boolean(envoi)}
                        title="Même texte, même voix, nouvelle intonation"
                        onClick={() => void generer({ voixId: c.voixId!, texte: c.texte, emotion: c.emotion, nom: c.nom })}
                      >
                        ↻ Varier
                      </button>
                    )}
                    <button
                      type="button"
                      className="bouton-danger px-3 py-1 text-sm"
                      onClick={async () => {
                        if (!confirm(`Supprimer « ${c.nom || "cette voix"} » ? Si elle est déjà dans un montage, elle n'y sera plus lisible.`)) return;
                        await supprimerCreation(projectId, c.id);
                        if (ouverte === c.id) setOuverte(null);
                        router.refresh();
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
                {c.texte && <p className="line-clamp-2 text-sm text-sourdine">{c.texte}</p>}
                {c.erreur && <p className="message-erreur text-sm">{c.erreur}</p>}
                {c.status === "terminee" && (c.urlMixage ?? c.urlAudio) && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio src={(c.urlMixage ?? c.urlAudio)!} controls preload="none" className="w-full" />
                )}
                {piste?.id === c.id && piste.urlAudio && (
                  <ConsoleMixage
                    key={piste.id}
                    projectId={projectId}
                    piste={{ id: piste.id, nom: piste.nom, url: piste.urlAudio, reglages: piste.reglages, voixId: piste.voixId }}
                    onEnregistre={() => router.refresh()}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
