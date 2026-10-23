import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { STATUTS_MONTAGE, couleurStatut, dateCourte, dureeLisible } from "@/lib/libelles";
import { type Media, lireTimeline, placer, timelineParDefaut } from "@/lib/montage";
import { signerLiens } from "@/lib/production";
import { getClient } from "@/lib/session";
import { changerStatutMontage, creerMontage, renommerMontage, supprimerMontage } from "./actions";
import { Editeur } from "./editeur";
import { ControleRaccords } from "./raccords";

type Montage = {
  id: string;
  title: string;
  take_ids: string[];
  status: "brouillon" | "a_valider" | "valide" | "a_corriger";
  comment: string | null;
  updated_at: string;
  timeline?: unknown;
};

type Clip = { takeId: string; planNumero: number; duree: number; videoPath: string | null; voix: string };

const MESSAGES: Record<string, string> = {
  cree: "Montage créé. Ajoutez voix off et musique, réglez les plans, regardez l'aperçu, puis envoyez-le à valider.",
  supprime: "Montage supprimé. Les clips restent disponibles.",
};
const STATUT_MESSAGE: Record<string, string> = {
  a_valider: "Montage envoyé à valider.",
  valide: "Montage validé. 🎉",
  a_corriger: "Montage renvoyé en correction, avec votre commentaire.",
  brouillon: "Montage rouvert en brouillon.",
};

export default async function PageMontage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await getClient();

  const [{ data: scenes }, { data: projet }, montages, { data: voixStudio }] = await Promise.all([
    supabase
      .from("scenes")
      .select("id, position, duration_s, voiceover_text, image_path, validated_take_id, takes!takes_scene_id_fkey(id, video_path)")
      .eq("project_id", id)
      .order("position"),
    supabase.from("projects").select("aspect_ratio").eq("id", id).single(),
    lireMontages(supabase, id),
    // Voix du studio voix (la version mixée si elle existe) ; sans la migration 0014, la liste reste vide
    supabase
      .from("voix_creations")
      .select("nom, audio_path, mixage_path, duree_s")
      .eq("project_id", id)
      .eq("status", "terminee")
      .order("created_at", { ascending: false }),
  ]);
  const format = (projet?.aspect_ratio as string) ?? "9:16";

  // Tous les clips du projet, repérés par leur essai ; les clips validés sont ceux proposés pour un montage
  const clips = new Map<string, Clip>();
  const disponibles: Clip[] = [];
  const photos: Media[] = [];
  (scenes ?? []).forEach((s, i) => {
    if (s.image_path) photos.push({ chemin: s.image_path, nature: "image", nom: `Photo plan ${i + 1}`, duree: null });
    for (const t of s.takes as { id: string; video_path: string | null }[]) {
      const clip = {
        takeId: t.id,
        planNumero: i + 1,
        duree: Number(s.duration_s || 5),
        videoPath: t.video_path,
        voix: s.voiceover_text,
      };
      clips.set(t.id, clip);
      if (t.id === s.validated_take_id && t.video_path) disponibles.push(clip);
    }
  });
  const enMedia = (c: Clip): Media => ({ chemin: c.videoPath!, nature: "video", nom: `Plan ${c.planNumero}`, duree: c.duree, takeId: c.takeId });
  const medias = disponibles.map(enMedia);
  const voix: Media[] = (voixStudio ?? []).flatMap((v) => {
    const chemin = (v.mixage_path ?? v.audio_path) as string | null;
    return chemin
      ? [{ chemin, nature: "audio" as const, nom: `${v.nom || "Voix"}${v.mixage_path ? " (mixée)" : ""}`, duree: v.duree_s !== null ? Number(v.duree_s) : null }]
      : [];
  });

  // L'éditeur s'ouvre sur un montage à la fois (le plus récent par défaut)
  const ouvert = montages.find((m) => m.id === sp.ouvert) ?? montages[0];
  const timeline = ouvert
    ? (lireTimeline(ouvert.timeline) ??
      timelineParDefaut(
        ouvert.take_ids.flatMap((t) => {
          const c = clips.get(t);
          return c?.videoPath ? [enMedia(c)] : [];
        }),
      ))
    : null;
  const liens = await signerLiens(supabase, [
    ...disponibles.map((c) => c.videoPath),
    ...photos.map((p) => p.chemin),
    ...voix.map((v) => v.chemin),
    ...(timeline ? [...timeline.bibliotheque.map((m) => m.chemin), ...timeline.pistes.flatMap((p) => p.elements.map((e) => e.chemin))] : []),
  ]);
  const message = Object.keys(MESSAGES).find((k) => sp[k]);

  return (
    <div className="flex flex-col gap-6">
      {message && <p className="message-ok">{MESSAGES[message]}</p>}
      {sp.statut && STATUT_MESSAGE[sp.statut] && <p className="message-ok">{STATUT_MESSAGE[sp.statut]}</p>}
      {sp.erreur && <p className="message-erreur">Cochez au moins un clip validé pour créer un montage.</p>}

      {/* 1. Choisir les clips validés */}
      <section className="carte flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold">Nouveau montage</h2>
          <p className="text-sm text-sourdine">
            Cochez les clips validés à mettre bout à bout (dans l'ordre des plans ; vous pourrez changer l'ordre ensuite). Vous
            pouvez faire plusieurs montages : un film long, une version courte pour Facebook, etc.
          </p>
        </div>
        {disponibles.length === 0 ? (
          <p className="text-sm text-sourdine">
            Aucun clip validé pour l'instant. Validez des clips dans{" "}
            <Link href={`/projets/${id}/clips`} className="lien">
              Clips
            </Link>
            .
          </p>
        ) : (
          <form action={creerMontage.bind(null, id)} className="flex flex-col gap-4">
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {disponibles.map((c) => (
                <li key={c.takeId}>
                  <label className="flex cursor-pointer flex-col gap-1 rounded-lg border border-ligne p-2 has-[:checked]:border-accent has-[:checked]:bg-accent-doux">
                    <video
                      src={c.videoPath ? liens.get(c.videoPath) : undefined}
                      muted
                      playsInline
                      preload="metadata"
                      className="aspect-video w-full rounded bg-black object-cover"
                    />
                    <span className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name="clips" value={c.takeId} defaultChecked className="accent-[var(--accent)]" />
                      <b>Plan {c.planNumero}</b> · {c.duree} s
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="titre-montage" className="etiquette">
                  Nom du montage
                </label>
                <input id="titre-montage" name="title" placeholder="Ex. : Version longue" className="champ" />
              </div>
              <BoutonEnvoi enCours="Création…">🎞 Créer le montage</BoutonEnvoi>
            </div>
          </form>
        )}
      </section>

      {/* 2. Les montages, à monter, valider ou corriger */}
      {montages.map((m) => {
        const estOuvert = m.id === ouvert?.id;
        const tl = estOuvert && timeline ? timeline : lireTimeline(m.timeline);
        const duree = tl ? placer(tl).duree : m.take_ids.reduce((n, t) => n + (clips.get(t)?.duree ?? 0), 0);
        const principale = tl ? tl.pistes[0].elements : [];
        const clipsLus = principale.flatMap((e) => {
          const url = liens.get(e.chemin);
          return e.nature === "video" && url ? [{ url, libelle: e.nom }] : [];
        });
        const modifiable = m.status === "brouillon" || m.status === "a_corriger";
        const vide = tl ? tl.pistes.every((p) => p.elements.length === 0) : m.take_ids.length === 0;
        return (
          <section key={m.id} id={`montage-${m.id}`} className="carte flex scroll-mt-24 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">{m.title}</h2>
              <span className={`pastille ${couleurStatut(m.status)}`}>{STATUTS_MONTAGE[m.status]}</span>
              <span className="text-sm text-sourdine">
                {dureeLisible(duree)} · modifié le {dateCourte(m.updated_at)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {!estOuvert && (
                  <Link href={`/projets/${id}/montage?ouvert=${m.id}#montage-${m.id}`} className="bouton-discret">
                    Ouvrir dans l'éditeur
                  </Link>
                )}
                <form action={supprimerMontage.bind(null, id, m.id)}>
                  <BoutonEnvoi className="bouton-danger" enCours="…" confirmer={`Supprimer le montage « ${m.title} » ?`}>
                    Supprimer
                  </BoutonEnvoi>
                </form>
              </div>
            </div>

            {m.status === "a_corriger" && (
              <p className="message-erreur">À corriger{m.comment ? ` : ${m.comment}` : "."} Modifiez le montage ci-dessous, puis renvoyez à valider.</p>
            )}

            {estOuvert && timeline && (
              <>
                <Editeur
                  key={m.id}
                  projectId={id}
                  montageId={m.id}
                  titre={m.title}
                  format={format}
                  modifiable={modifiable}
                  initiale={timeline}
                  clips={medias}
                  photos={photos}
                  voix={voix}
                  liensInitiaux={Object.fromEntries(liens)}
                />
                <div className="flex flex-wrap items-start gap-4">
                  {modifiable && (
                    <form action={renommerMontage.bind(null, id, m.id)} className="flex gap-2">
                      <input name="title" defaultValue={m.title} className="champ text-sm" aria-label="Nom du montage" />
                      <BoutonEnvoi className="bouton-discret shrink-0 px-3" enCours="…">
                        Renommer
                      </BoutonEnvoi>
                    </form>
                  )}
                  {clipsLus.length > 1 && (
                    <details className="min-w-64 flex-1 text-sm">
                      <summary className="cursor-pointer font-semibold">🔍 Contrôler les raccords entre les plans</summary>
                      <div className="mt-3">
                        <ControleRaccords clips={clipsLus} />
                      </div>
                    </details>
                  )}
                </div>
              </>
            )}

            <div className="flex flex-wrap items-start gap-3 border-t border-ligne pt-4">
              {modifiable && (
                <form action={changerStatutMontage.bind(null, id, m.id, "a_valider")}>
                  <BoutonEnvoi enCours="Envoi…" disabled={vide}>
                    Envoyer à valider →
                  </BoutonEnvoi>
                </form>
              )}
              {m.status === "a_valider" && (
                <>
                  <form action={changerStatutMontage.bind(null, id, m.id, "valide")}>
                    <BoutonEnvoi enCours="Validation…">✓ Valider le montage</BoutonEnvoi>
                  </form>
                  <form action={changerStatutMontage.bind(null, id, m.id, "a_corriger")} className="flex min-w-64 flex-1 gap-2">
                    <input name="comment" placeholder="Ce qu'il faut corriger (ex. : enlever le plan 3)" className="champ text-sm" />
                    <BoutonEnvoi className="bouton-danger shrink-0" enCours="…">
                      ✗ À corriger
                    </BoutonEnvoi>
                  </form>
                </>
              )}
              {m.status === "valide" && (
                <>
                  <p className="text-sm text-succes">Validé. Téléchargez le film en 480p ou 720p HD dans l'éditeur ci-dessus.</p>
                  <form action={changerStatutMontage.bind(null, id, m.id, "brouillon")}>
                    <BoutonEnvoi className="bouton-discret" enCours="…">
                      Rouvrir pour modifier
                    </BoutonEnvoi>
                  </form>
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof getClient>>;

// La colonne « timeline » arrive avec la migration 0012 : sans elle, la page reste utilisable
async function lireMontages(supabase: Supabase, projectId: string): Promise<Montage[]> {
  const avec = await supabase
    .from("montages")
    .select("id, title, take_ids, status, comment, updated_at, timeline")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (!avec.error) return (avec.data ?? []) as Montage[];
  const { data } = await supabase
    .from("montages")
    .select("id, title, take_ids, status, comment, updated_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Montage[];
}
