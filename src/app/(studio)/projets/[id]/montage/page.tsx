import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { STATUTS_MONTAGE, couleurStatut, dateCourte, dureeLisible } from "@/lib/libelles";
import { signerLiens } from "@/lib/production";
import { getClient } from "@/lib/session";
import {
  ajouterClip,
  changerStatutMontage,
  creerMontage,
  deplacerClip,
  renommerMontage,
  retirerClip,
  supprimerMontage,
} from "./actions";
import { LecteurMontage } from "./lecteur";

type Montage = {
  id: string;
  title: string;
  take_ids: string[];
  status: "brouillon" | "a_valider" | "valide" | "a_corriger";
  comment: string | null;
  updated_at: string;
};

type Clip = { takeId: string; planNumero: number; duree: number; videoPath: string | null; voix: string };

const MESSAGES: Record<string, string> = {
  cree: "Montage créé. Vérifiez l'ordre, regardez l'aperçu, puis envoyez-le à valider.",
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

  const [{ data: scenes }, { data: brut }] = await Promise.all([
    supabase
      .from("scenes")
      .select("id, position, duration_s, voiceover_text, validated_take_id, takes!takes_scene_id_fkey(id, video_path)")
      .eq("project_id", id)
      .order("position"),
    supabase
      .from("montages")
      .select("id, title, take_ids, status, comment, updated_at")
      .eq("project_id", id)
      .order("created_at", { ascending: false }),
  ]);
  const montages = (brut ?? []) as Montage[];

  // Tous les clips du projet, repérés par leur essai ; les clips validés sont ceux proposés pour un montage
  const clips = new Map<string, Clip>();
  const disponibles: Clip[] = [];
  (scenes ?? []).forEach((s, i) => {
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
  const liens = await signerLiens(
    supabase,
    [...disponibles.map((c) => c.videoPath), ...montages.flatMap((m) => m.take_ids.map((t) => clips.get(t)?.videoPath))],
  );
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

      {/* 2. Les montages, à revoir, valider ou corriger */}
      {montages.map((m) => {
        const liste = m.take_ids.map((t) => clips.get(t)).filter((c): c is Clip => Boolean(c));
        const duree = liste.reduce((n, c) => n + c.duree, 0);
        const absents = disponibles.filter((c) => !m.take_ids.includes(c.takeId));
        const modifiable = m.status === "brouillon" || m.status === "a_corriger";
        return (
          <section key={m.id} id={`montage-${m.id}`} className="carte flex scroll-mt-24 flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">{m.title}</h2>
              <span className={`pastille ${couleurStatut(m.status)}`}>{STATUTS_MONTAGE[m.status]}</span>
              <span className="text-sm text-sourdine">
                {liste.length} clip{liste.length > 1 ? "s" : ""} · {dureeLisible(duree)} · modifié le {dateCourte(m.updated_at)}
              </span>
              <form action={supprimerMontage.bind(null, id, m.id)} className="ml-auto">
                <BoutonEnvoi className="bouton-danger" enCours="…" confirmer={`Supprimer le montage « ${m.title} » ?`}>
                  Supprimer
                </BoutonEnvoi>
              </form>
            </div>

            {m.status === "a_corriger" && (
              <p className="message-erreur">À corriger{m.comment ? ` : ${m.comment}` : "."} Modifiez les clips ci-dessous, puis renvoyez à valider.</p>
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
              <LecteurMontage
                clips={liste.flatMap((c) => {
                  const url = c.videoPath ? liens.get(c.videoPath) : undefined;
                  return url ? [{ url, libelle: `Plan ${c.planNumero}` }] : [];
                })}
              />

              <div className="flex flex-col gap-3">
                <p className="etiquette">Ordre des clips</p>
                <ol className="flex flex-col divide-y divide-ligne rounded-lg border border-ligne text-sm">
                  {liste.map((c, i) => (
                    <li key={`${c.takeId}-${i}`} className="flex items-center gap-2 px-3 py-2">
                      <span className="w-5 text-sourdine">{i + 1}.</span>
                      <span className="min-w-0 flex-1 truncate">
                        <b>Plan {c.planNumero}</b> <span className="text-sourdine">{c.voix}</span>
                      </span>
                      {modifiable && (
                        <>
                          {i > 0 && (
                            <form action={deplacerClip.bind(null, id, m.id, i, -1)}>
                              <BoutonEnvoi className="bouton-discret px-2 py-0.5" enCours="…">
                                ↑
                              </BoutonEnvoi>
                            </form>
                          )}
                          {i < liste.length - 1 && (
                            <form action={deplacerClip.bind(null, id, m.id, i, 1)}>
                              <BoutonEnvoi className="bouton-discret px-2 py-0.5" enCours="…">
                                ↓
                              </BoutonEnvoi>
                            </form>
                          )}
                          <form action={retirerClip.bind(null, id, m.id, i)}>
                            <BoutonEnvoi className="bouton-danger px-2 py-0.5" enCours="…">
                              ✗
                            </BoutonEnvoi>
                          </form>
                        </>
                      )}
                    </li>
                  ))}
                </ol>
                {modifiable && absents.length > 0 && (
                  <form action={ajouterClip.bind(null, id, m.id)} className="flex gap-2">
                    <select name="clip" className="champ text-sm" aria-label="Clip à ajouter">
                      {absents.map((c) => (
                        <option key={c.takeId} value={c.takeId}>
                          Plan {c.planNumero} ({c.duree} s)
                        </option>
                      ))}
                    </select>
                    <BoutonEnvoi className="bouton-discret shrink-0 px-3" enCours="…">
                      Ajouter
                    </BoutonEnvoi>
                  </form>
                )}
                {modifiable && (
                  <form action={renommerMontage.bind(null, id, m.id)} className="flex gap-2">
                    <input name="title" defaultValue={m.title} className="champ text-sm" aria-label="Nom du montage" />
                    <BoutonEnvoi className="bouton-discret shrink-0 px-3" enCours="…">
                      Renommer
                    </BoutonEnvoi>
                  </form>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-start gap-3 border-t border-ligne pt-4">
              {modifiable && (
                <form action={changerStatutMontage.bind(null, id, m.id, "a_valider")}>
                  <BoutonEnvoi enCours="Envoi…" disabled={liste.length === 0}>
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
                  <p className="text-sm text-succes">
                    Validé. L'export en un seul fichier MP4 (avec voix off et musique) arrive à la prochaine étape du studio ; en
                    attendant, chaque clip se télécharge depuis « Clips ».
                  </p>
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
