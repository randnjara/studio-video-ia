import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { STATUTS_PLAN, couleurStatut } from "@/lib/libelles";
import { signerLiens, suivreEssais } from "@/lib/production";
import { MOTEURS, type Moteur, estMoteur, moteurParDefaut } from "@/lib/runpod";
import { getClient } from "@/lib/session";
import { refuserClips, regenerer, retirerValidation, supprimerClip, validerClip } from "./actions";
import { SuiviEssais } from "./suivi-essais";

type Essai = {
  id: string;
  status: "en_attente" | "en_cours" | "terminee" | "echouee" | "annulee";
  runpod_job_id: string | null;
  moteur: string;
  video_path: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

type Plan = {
  id: string;
  position: number;
  image_path: string | null;
  voiceover_text: string;
  status: string;
  validated_take_id: string | null;
  takes: Essai[];
};

const ERREURS: Record<string, string> = {
  plan: "Plan introuvable.",
  "sans-photo": "Ce plan n'a pas de photo : complétez-le dans « Plans ».",
  "sans-prompt": "Ce plan n'a pas de mouvement : complétez-le dans « Plans ».",
  "sans-accord": "L'accord des personnes photographiées n'est pas coché : voyez « Plans ».",
  budget: "Le plafond GPU du mois est atteint. Le responsable peut l'augmenter dans « Équipe et budget ».",
  essai: "La génération n'a pas pu démarrer. Réessayez.",
};

const FILTRES = [
  { cle: "a_valider", libelle: "À valider" },
  { cle: "en_cours", libelle: "En génération" },
  { cle: "validee", libelle: "Validés" },
  { cle: "tous", libelle: "Tous" },
] as const;

const SELECT =
  "id, position, image_path, voiceover_text, status, validated_take_id, takes!takes_scene_id_fkey(id, status, runpod_job_id, moteur, video_path, cost_usd, error, created_at)";

const moteurDe = (t: Essai): Moteur => (estMoteur(t.moteur) ? t.moteur : "qualite");

export default async function PageClips({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await getClient();

  const lire = () =>
    supabase
      .from("scenes")
      .select(SELECT)
      .eq("project_id", id)
      .order("position")
      .order("created_at", { referencedTable: "takes", ascending: false });

  let plans = ((await lire()).data ?? []) as Plan[];

  // Range d'abord les vidéos qui ont fini pendant que la page était fermée (seulement s'il y en a en cours)
  const enCoursAvant = plans.flatMap((p) =>
    p.takes
      .filter((t) => t.status === "en_cours")
      .map((t) => ({
        id: t.id,
        scene_id: p.id,
        runpod_job_id: t.runpod_job_id,
        moteur: moteurDe(t),
        sceneValidee: p.status === "validee",
      })),
  );
  if (enCoursAvant.length > 0) {
    const restants = await suivreEssais(supabase, id, enCoursAvant);
    if (restants < enCoursAvant.length) plans = ((await lire()).data ?? []) as Plan[];
  }

  const avecClips = plans.filter((p) => p.takes.length > 0);
  const sansClip = plans.length - avecClips.length;
  const enCours = plans.reduce((n, p) => n + p.takes.filter((t) => t.status === "en_cours").length, 0);
  const cout = plans.reduce((n, p) => n + p.takes.reduce((m, t) => m + Number(t.cost_usd ?? 0), 0), 0);
  const compte = {
    a_valider: avecClips.filter((p) => p.status === "a_valider").length,
    en_cours: avecClips.filter((p) => p.takes.some((t) => t.status === "en_cours")).length,
    validee: avecClips.filter((p) => p.status === "validee").length,
    tous: avecClips.length,
  };
  const filtre = (FILTRES.find((f) => f.cle === sp.filtre)?.cle ?? (compte.a_valider > 0 ? "a_valider" : "tous")) as keyof typeof compte;
  const affiches = avecClips.filter((p) =>
    filtre === "tous" ? true : filtre === "en_cours" ? p.takes.some((t) => t.status === "en_cours") : p.status === filtre,
  );

  const liens = await signerLiens(
    supabase,
    affiches.flatMap((p) => [p.image_path, ...p.takes.map((t) => t.video_path)]),
  );

  return (
    <div className="flex flex-col gap-6">
      {sp.erreur && ERREURS[sp.erreur] && <p className="message-erreur">{ERREURS[sp.erreur]}</p>}
      {sp.lances && (
        <p className="message-ok">
          {sp.lances} clip{Number(sp.lances) > 1 ? "s envoyés" : " envoyé"} à la génération.
          {sp.ignores ? ` ${sp.ignores} plan(s) n'ont pas pu partir (photo, mouvement ou accord manquant, ou plafond atteint).` : ""}
        </p>
      )}
      {sp.valide && (
        <p className="message-ok">
          Clip validé. Il est maintenant disponible dans <Link href={`/projets/${id}/montage`} className="underline">Montage</Link>.
        </p>
      )}
      <SuiviEssais projectId={id} enCours={enCours} />

      <div className="flex flex-wrap items-center gap-2">
        {FILTRES.map((f) => (
          <Link
            key={f.cle}
            href={`/projets/${id}/clips?filtre=${f.cle}`}
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              filtre === f.cle ? "bg-accent text-accent-texte" : "bg-surface-2 text-sourdine hover:text-encre"
            }`}
          >
            {f.libelle} ({compte[f.cle]})
          </Link>
        ))}
        <span className="ml-auto text-sm text-sourdine">Dépensé sur ce projet : {cout.toFixed(2)} $</span>
      </div>

      {sansClip > 0 && (
        <p className="text-sm text-sourdine">
          {sansClip} plan{sansClip > 1 ? "s n'ont" : " n'a"} pas encore été envoyé{sansClip > 1 ? "s" : ""} à la génération :{" "}
          <Link href={`/projets/${id}/plans`} className="lien">
            les choisir dans Plans
          </Link>
          .
        </p>
      )}

      {affiches.length === 0 ? (
        <p className="carte text-sm text-sourdine">
          {avecClips.length === 0
            ? "Aucun clip pour l'instant. Dans « Plans », cochez les plans à transformer en vidéo et cliquez sur « Envoyer la sélection »."
            : "Rien dans ce filtre."}
        </p>
      ) : (
        affiches.map((plan) => {
          const n = plans.indexOf(plan) + 1;
          const photo = plan.image_path ? liens.get(plan.image_path) : undefined;
          const tourne = plan.takes.some((t) => t.status === "en_cours");
          const prochainMoteur = plan.takes[0] ? moteurDe(plan.takes[0]) : moteurParDefaut();
          return (
            <section key={plan.id} id={`plan-${plan.id}`} className="carte flex scroll-mt-24 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {photo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt="" className="h-10 w-16 rounded object-cover" />
                )}
                <h2 className="font-bold">Plan {n}</h2>
                <span className={`pastille ${couleurStatut(plan.status)}`}>{STATUTS_PLAN[plan.status] ?? plan.status}</span>
                <p className="min-w-0 flex-1 truncate text-sm text-sourdine">{plan.voiceover_text}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={regenerer.bind(null, id, plan.id)}>
                    <BoutonEnvoi
                      className="bouton-discret px-3 py-1.5 text-sm"
                      enCours="Lancement…"
                      disabled={tourne}
                      confirmer={`Générer un nouveau clip (${MOTEURS[prochainMoteur].libelle}) pour environ ${MOTEURS[prochainMoteur].prix5s.toFixed(2)} $ ?`}
                    >
                      ↻ Regénérer
                    </BoutonEnvoi>
                  </form>
                  {plan.status !== "refusee" && (
                    <form action={refuserClips.bind(null, id, plan.id)}>
                      <BoutonEnvoi
                        className="bouton-danger"
                        enCours="…"
                        confirmer="Aucun clip ne convient ? Le plan repart dans « Plans » pour être modifié."
                      >
                        ✗ Refuser, à modifier
                      </BoutonEnvoi>
                    </form>
                  )}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {plan.takes.map((t, k) => {
                  const video = t.video_path ? liens.get(t.video_path) : undefined;
                  const choisi = plan.validated_take_id === t.id;
                  return (
                    <div key={t.id} className={`rounded-lg border p-3 ${choisi ? "border-succes bg-succes-doux" : "border-ligne"}`}>
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        Essai {plan.takes.length - k}
                        <span className="font-normal text-sourdine">· {MOTEURS[moteurDe(t)].libelle}</span>
                        {choisi && <span className="pastille bg-succes text-surface">✓ Validé</span>}
                      </p>
                      {t.status === "en_cours" && (
                        <div className="flex aspect-video items-center justify-center rounded-md bg-surface-2 text-sm text-sourdine">
                          Génération en cours…
                        </div>
                      )}
                      {t.status === "echouee" && (
                        <p className="text-sm text-alerte">Échec (non facturé) : {t.error ?? "erreur inconnue"}</p>
                      )}
                      {video && <video src={video} controls loop playsInline preload="metadata" className="w-full rounded-md bg-black" />}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                        {video &&
                          (choisi ? (
                            <form action={retirerValidation.bind(null, id, plan.id)}>
                              <BoutonEnvoi className="bouton-discret px-3 py-1" enCours="…">
                                Retirer la validation
                              </BoutonEnvoi>
                            </form>
                          ) : (
                            <form action={validerClip.bind(null, id, plan.id, t.id)}>
                              <BoutonEnvoi className="bouton px-3 py-1" enCours="Validation…">
                                ✓ Valider
                              </BoutonEnvoi>
                            </form>
                          ))}
                        {video && (
                          <a href={video} download className="lien">
                            Télécharger
                          </a>
                        )}
                        {t.status !== "en_cours" && (
                          <form action={supprimerClip.bind(null, id, plan.id, t.id)} className="ml-auto">
                            <BoutonEnvoi className="bouton-danger px-2 py-1" enCours="…" confirmer="Supprimer ce clip ?">
                              Supprimer
                            </BoutonEnvoi>
                          </form>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
