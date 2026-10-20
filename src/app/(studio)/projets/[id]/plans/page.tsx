import Link from "next/link";
import { notFound } from "next/navigation";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { STATUTS_PLAN, couleurStatut, dureeLisible } from "@/lib/libelles";
import { PRIX_ESTIME_5S_USD } from "@/lib/runpod";
import { requireProfile } from "@/lib/session";
import {
  actualiserEssais,
  annulerValidation,
  deplacerPlan,
  genererEssai,
  genererTout,
  supprimerPlan,
  validerEssai,
} from "./actions";
import { FormulairePlan } from "./formulaire-plan";
import { ImportGroupe } from "./import-groupe";
import { SuiviEssais } from "./suivi-essais";

type Essai = {
  id: string;
  status: "en_attente" | "en_cours" | "terminee" | "echouee" | "annulee";
  video_path: string | null;
  cost_usd: number | null;
  error: string | null;
  created_at: string;
};

type Plan = {
  id: string;
  position: number;
  motion_prompt: string;
  voiceover_text: string;
  image_path: string | null;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
  validated_take_id: string | null;
  takes: Essai[];
};

const ERREURS: Record<string, string> = {
  plan: "Le plan n'a pas pu être enregistré. Réessayez.",
  "sans-photo": "Ajoutez une photo au plan avant de générer.",
  "sans-prompt": "Décrivez le mouvement voulu avant de générer.",
  "sans-accord": "Cochez la case d'accord des personnes photographiées avant de générer.",
  budget: "Le plafond GPU du mois est atteint. Le responsable peut l'augmenter dans « Équipe et budget ».",
  essai: "La génération n'a pas pu démarrer. Réessayez.",
  import: "Les plans n'ont pas pu être créés. Réessayez.",
  "import-vide": "Ajoutez un script ou des photos avant de créer les plans.",
};

export default async function PagePlans({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase } = await requireProfile();

  const { data: projet } = await supabase
    .from("projects")
    .select("id, title, aspect_ratio, scenario_text")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!projet) notFound();

  // Range d'abord les vidéos qui ont fini pendant que la page était fermée
  await actualiserEssais(id);

  const { data } = await supabase
    .from("scenes")
    .select(
      "id, position, motion_prompt, voiceover_text, image_path, consent_confirmed, duration_s, status, validated_take_id, takes(id, status, video_path, cost_usd, error, created_at)",
    )
    .eq("project_id", id)
    .order("position")
    .order("created_at", { referencedTable: "takes", ascending: false });
  const plans = (data ?? []) as Plan[];

  // Liens temporaires (1 h) pour afficher les photos et les vidéos privées
  const chemins = plans.flatMap((p) => [
    ...(p.image_path ? [p.image_path] : []),
    ...p.takes.flatMap((t) => (t.video_path ? [t.video_path] : [])),
  ]);
  const liens = new Map<string, string>();
  if (chemins.length > 0) {
    const { data: signes } = await supabase.storage.from("medias").createSignedUrls(chemins, 60 * 60);
    for (const s of signes ?? []) if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
  }

  const enCours = plans.reduce((n, p) => n + p.takes.filter((t) => t.status === "en_cours").length, 0);
  const valides = plans.filter((p) => p.status === "validee").length;
  const cout = plans.reduce((n, p) => n + p.takes.reduce((m, t) => m + Number(t.cost_usd ?? 0), 0), 0);
  const prets = plans.filter(
    (p) =>
      p.image_path &&
      p.motion_prompt &&
      p.consent_confirmed &&
      !p.takes.some((t) => t.status === "en_cours" || t.status === "terminee"),
  ).length;
  const duree = plans.reduce((n, p) => n + Number(p.duration_s || 5), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <Link href={`/projets/${id}`} className="lien text-sm">
            ← Fiche du projet
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">Plans de « {projet.title} »</h1>
          <p className="text-sm text-sourdine">
            Format {projet.aspect_ratio} · {plans.length} plan{plans.length > 1 ? "s" : ""} ({dureeLisible(duree)}) ·{" "}
            {valides} validé{valides > 1 ? "s" : ""} · dépensé {cout.toFixed(2)} $
          </p>
        </div>
        {prets > 0 && (
          <form action={genererTout.bind(null, id)}>
            <BoutonEnvoi
              enCours="Lancement…"
              confirmer={`Générer ${prets} vidéo${prets > 1 ? "s" : ""} pour environ ${(prets * PRIX_ESTIME_5S_USD).toFixed(2)} $ ?`}
            >
              ▶ Générer les {prets} plans prêts
            </BoutonEnvoi>
          </form>
        )}
      </div>

      {sp.erreur && ERREURS[sp.erreur] && <p className="message-erreur">{ERREURS[sp.erreur]}</p>}
      {sp.enregistre && <p className="message-ok">Plan enregistré.</p>}
      {sp.ajoute && <p className="message-ok">Plan ajouté.</p>}
      {sp.importe && <p className="message-ok">{sp.importe} plans créés. Vérifiez chaque photo et chaque mouvement, puis générez.</p>}
      {sp.lances && <p className="message-ok">{sp.lances} génération(s) lancée(s).</p>}
      {sp.valide && (
        <p className="message-ok">
          Plan validé : il est maintenant dans le <Link href={`/projets/${id}`} className="underline">montage du projet</Link>, à sa
          place dans l'ordre du scénario.
        </p>
      )}
      <SuiviEssais projectId={id} enCours={enCours} />

      <details className="carte" open={plans.length === 0}>
        <summary className="cursor-pointer font-semibold">⚡ Ajouter toutes les photos et le script en une fois</summary>
        <div className="mt-4">
          <ImportGroupe projectId={id} scenario={projet.scenario_text ?? ""} />
        </div>
      </details>

      {plans.map((plan, i) => {
        const photo = plan.image_path ? liens.get(plan.image_path) : undefined;
        const enGeneration = plan.takes.some((t) => t.status === "en_cours");
        return (
          <section
            key={plan.id}
            id={`plan-${plan.id}`}
            className={`carte flex scroll-mt-24 flex-col gap-4 ${plan.status === "validee" ? "border-succes/50" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">Plan {i + 1}</h2>
              <span className={`pastille ${couleurStatut(plan.status)}`}>{STATUTS_PLAN[plan.status] ?? plan.status}</span>
              <div className="ml-auto flex items-center gap-1 text-sm">
                {i > 0 && (
                  <form action={deplacerPlan.bind(null, id, plan.id, -1)}>
                    <BoutonEnvoi className="bouton-discret px-2 py-1" enCours="…">
                      ↑
                    </BoutonEnvoi>
                  </form>
                )}
                {i < plans.length - 1 && (
                  <form action={deplacerPlan.bind(null, id, plan.id, 1)}>
                    <BoutonEnvoi className="bouton-discret px-2 py-1" enCours="…">
                      ↓
                    </BoutonEnvoi>
                  </form>
                )}
                <form action={supprimerPlan.bind(null, id, plan.id)}>
                  <BoutonEnvoi className="bouton-danger" enCours="…" confirmer={`Supprimer le plan ${i + 1} et ses vidéos ?`}>
                    Supprimer
                  </BoutonEnvoi>
                </form>
              </div>
            </div>

            <FormulairePlan projectId={id} plan={plan} photoUrl={photo} />

            <div className="flex flex-wrap items-center gap-3 border-t border-ligne pt-4">
              <form action={genererEssai.bind(null, id, plan.id)}>
                <BoutonEnvoi enCours="Lancement…" disabled={enGeneration}>
                  {enGeneration ? "Génération en cours…" : plan.takes.length > 0 ? "▶ Générer un autre essai" : "▶ Générer la vidéo"}
                </BoutonEnvoi>
              </form>
              <span className="text-sm text-sourdine">environ {PRIX_ESTIME_5S_USD.toFixed(2)} $ par essai de 5 s</span>
            </div>

            {plan.takes.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                {plan.takes.map((t, n) => {
                  const video = t.video_path ? liens.get(t.video_path) : undefined;
                  const choisi = plan.validated_take_id === t.id;
                  return (
                    <div
                      key={t.id}
                      className={`rounded-lg border p-3 ${choisi ? "border-succes bg-succes-doux" : "border-ligne"}`}
                    >
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        Essai {plan.takes.length - n}
                        {choisi && <span className="pastille bg-succes text-surface">✓ Dans le montage</span>}
                      </p>
                      {t.status === "en_cours" && <p className="text-sm text-sourdine">Génération en cours…</p>}
                      {t.status === "echouee" && (
                        <p className="text-sm text-alerte">Échec (non facturé) : {t.error ?? "erreur inconnue"}</p>
                      )}
                      {video && (
                        <>
                          <video src={video} controls loop playsInline className="w-full rounded-md bg-black" />
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                            {choisi ? (
                              <form action={annulerValidation.bind(null, id, plan.id)}>
                                <BoutonEnvoi className="bouton-discret px-3 py-1" enCours="…">
                                  Retirer du montage
                                </BoutonEnvoi>
                              </form>
                            ) : (
                              <form action={validerEssai.bind(null, id, plan.id, t.id)}>
                                <BoutonEnvoi className="bouton px-3 py-1" enCours="Validation…">
                                  ✓ Valider cet essai
                                </BoutonEnvoi>
                              </form>
                            )}
                            <a href={video} download className="lien">
                              Télécharger
                            </a>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <section className="carte">
        <h2 className="text-lg font-bold">Ajouter un plan</h2>
        <p className="mt-1 mb-4 text-sm text-sourdine">
          Un plan = une photo + le mouvement voulu, pour un clip de 5 secondes. Ajoutez autant de plans qu'il en faut : la durée
          de la vidéo finale n'est pas limitée.
        </p>
        <FormulairePlan projectId={id} />
      </section>
    </div>
  );
}
