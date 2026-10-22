import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { STATUTS_PLAN, couleurStatut, dureeLisible } from "@/lib/libelles";
import { signerLiens } from "@/lib/production";
import { MOTEURS, moteursDisponibles } from "@/lib/runpod";
import { getClient } from "@/lib/session";
import { deplacerPlan, envoyerALaGeneration, restaurerScript, supprimerPlan, supprimerPlans } from "./actions";
import { FormulairePlan } from "./formulaire-plan";
import { ImportGroupe } from "./import-groupe";
import { BarreSelection } from "./selection";

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
  takes: { status: string }[];
};

type Version = { id: number; created_at: string; data: { scenario_text?: string } };

const ERREURS: Record<string, string> = {
  plan: "Le plan n'a pas pu être enregistré. Réessayez.",
  "sans-photo": "Ajoutez une photo au plan avant de générer.",
  "sans-prompt": "Décrivez le mouvement voulu avant de générer.",
  "sans-accord": "Cochez la case d'accord des personnes photographiées avant de générer.",
  budget: "Le plafond GPU du mois est atteint. Le responsable peut l'augmenter dans « Équipe et budget ».",
  essai: "La génération n'a pas pu démarrer. Réessayez.",
  import: "Les plans n'ont pas pu être créés. Réessayez.",
  "import-vide": "Ajoutez un script ou des photos avant de créer les plans.",
  "selection-vide": "Aucun plan à envoyer : cochez des plans qui ne sont pas déjà en génération.",
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
  const supabase = await getClient();

  // Le cadre du projet vérifie déjà la connexion et l'existence du projet : tout part en même temps
  const [{ data: projet }, { data }, { data: versions }, moteurs] = await Promise.all([
    supabase.from("projects").select("scenario_text").eq("id", id).maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, position, motion_prompt, voiceover_text, image_path, consent_confirmed, duration_s, status, validated_take_id, takes!takes_scene_id_fkey(status)",
      )
      .eq("project_id", id)
      .order("position"),
    supabase
      .from("project_versions")
      .select("id, created_at, data")
      .eq("project_id", id)
      .eq("kind", "scenario")
      .order("created_at", { ascending: false })
      .limit(8),
    moteursDisponibles(),
  ]);
  const plans = (data ?? []) as Plan[];
  const liens = await signerLiens(
    supabase,
    plans.map((p) => p.image_path),
  );

  const pret = (p: Plan) => Boolean(p.image_path && p.motion_prompt && p.consent_confirmed);
  const enCours = (p: Plan) => p.takes.some((t) => t.status === "en_cours");
  const nouveaux = plans.filter((p) => pret(p) && !enCours(p) && !p.takes.some((t) => t.status === "terminee")).length;
  const duree = plans.reduce((n, p) => n + Number(p.duration_s || 5), 0);
  const refuses = plans.filter((p) => p.status === "refusee").length;
  // Résumé affiché quand le tableau est replié, et ouverture automatique après une action sur un plan
  const parStatut = Object.entries(
    plans.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {}),
  );
  const apercu = parStatut.map(([st, n]) => `${n} ${(STATUTS_PLAN[st] ?? st).toLowerCase()}`).join(" · ");
  const ouvert = Boolean(sp.ajoute || sp.enregistre || sp.importe || sp.refuse || sp.ouvert);

  return (
    <div className="flex flex-col gap-6">
      {sp.erreur && ERREURS[sp.erreur] && <p className="message-erreur">{ERREURS[sp.erreur]}</p>}
      {sp.ajoute && <p className="message-ok">Plan ajouté en bas du tableau.</p>}
      {sp.enregistre && <p className="message-ok">Plan enregistré.</p>}
      {sp.supprime && (
        <p className="message-ok">{Number(sp.supprime) > 1 ? `${sp.supprime} plans supprimés.` : "Plan supprimé."}</p>
      )}
      {sp["script-restaure"] && <p className="message-ok">Ancien script remis dans la zone de texte.</p>}
      {sp.importe && (
        <p className="message-ok">
          {sp.importe} plans créés. Vérifiez-les ci-dessous, puis cochez ceux à envoyer à la génération.
        </p>
      )}
      {refuses > 0 && (
        <p className="message-erreur">
          {refuses} plan{refuses > 1 ? "s ont" : " a"} un clip refusé : modifiez la photo ou le mouvement, puis renvoyez-le à la
          génération.
        </p>
      )}

      {/* 1. Créer des plans, en une ou plusieurs fois */}
      <section className="carte flex flex-col gap-4" id="script">
        <div>
          <h2 className="text-lg font-bold">Créer des plans</h2>
          <p className="text-sm text-sourdine">
            Un plan = une photo + un mouvement de caméra + le texte de la voix off, pour un clip de 5 secondes. Ajoutez-en autant
            que vous voulez, en une ou plusieurs fois : la durée de la vidéo n'est pas limitée.
          </p>
        </div>
        <details className="rounded-lg border border-ligne p-4" open={plans.length === 0}>
          <summary className="cursor-pointer font-semibold">⚡ Plusieurs plans d'un coup : script + photos</summary>
          <div className="mt-4 flex flex-col gap-4">
            <ImportGroupe projectId={id} scenario={projet?.scenario_text ?? ""} />
            {versions && versions.length > 0 && (
              <div>
                <p className="etiquette">Scripts précédents</p>
                <ul className="flex flex-col divide-y divide-ligne rounded-lg border border-ligne text-sm">
                  {(versions as Version[]).map((v) => (
                    <li key={v.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="shrink-0 text-sourdine">
                        {new Date(v.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{v.data.scenario_text?.slice(0, 90) || "(vide)"}</span>
                      <form action={restaurerScript.bind(null, id, v.id)}>
                        <BoutonEnvoi className="lien" enCours="…">
                          Reprendre
                        </BoutonEnvoi>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
        <details className="rounded-lg border border-ligne p-4">
          <summary className="cursor-pointer font-semibold">＋ Un seul plan</summary>
          <div className="mt-4">
            <FormulairePlan projectId={id} />
          </div>
        </details>
      </section>

      {/* 2. Le tableau des plans, et l'envoi à la génération */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">Tableau des plans</h2>
          <span className="text-sm text-sourdine">
            {plans.length} plan{plans.length > 1 ? "s" : ""} · {dureeLisible(duree)} de vidéo au total
          </span>
        </div>

        {plans.length === 0 ? (
          <p className="carte text-sm text-sourdine">Aucun plan pour l'instant. Créez-les ci-dessus.</p>
        ) : (
          <>
            <form id="selection" action={envoyerALaGeneration.bind(null, id)} className="carte sticky top-2 z-[5]">
              <BarreSelection
                moteurs={moteurs.map((m) => ({ id: m, ...MOTEURS[m] }))}
                prets={nouveaux}
                supprimer={supprimerPlans.bind(null, id)}
              />
            </form>
            {/* Au-delà de 4 plans, le tableau se replie (menu déroulant) pour garder la page lisible */}
            <details className="group" open={plans.length <= 4 || ouvert}>
              <summary className="carte flex cursor-pointer list-none items-center gap-3 py-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span className="transition group-open:rotate-90">▶</span>
                <span className="flex-1">
                  {plans.length} plans : {apercu}
                </span>
                <span className="text-accent group-open:hidden">Afficher</span>
                <span className="hidden text-accent group-open:inline">Replier</span>
              </summary>
            <ol className="mt-4 grid gap-4 lg:grid-cols-2">
              {plans.map((plan, i) => {
                const photo = plan.image_path ? liens.get(plan.image_path) : undefined;
                const nbClips = plan.takes.filter((t) => t.status === "terminee").length;
                const manque = !plan.image_path ? "photo" : !plan.motion_prompt ? "mouvement" : !plan.consent_confirmed ? "accord" : null;
                return (
                  <li
                    key={plan.id}
                    id={`plan-${plan.id}`}
                    className={`carte flex scroll-mt-28 flex-col gap-3 ${
                      plan.status === "refusee" ? "border-alerte/50" : plan.status === "validee" ? "border-succes/50" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        name="plans"
                        value={plan.id}
                        form="selection"
                        disabled={enCours(plan)}
                        data-pret={pret(plan) ? "1" : undefined}
                        aria-label={`Sélectionner le plan ${i + 1}`}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <h3 className="font-bold whitespace-nowrap">Plan {i + 1}</h3>
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
                          <BoutonEnvoi className="bouton-danger px-2 py-1" enCours="…" confirmer={`Supprimer le plan ${i + 1} et ses clips ?`}>
                            Supprimer
                          </BoutonEnvoi>
                        </form>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt="" className="aspect-video w-36 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <div className="flex aspect-video w-36 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-alerte/50 text-xs text-alerte">
                          Photo manquante
                        </div>
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="line-clamp-3">{plan.voiceover_text || <span className="text-sourdine">(pas de voix off)</span>}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-sourdine">🎥 {plan.motion_prompt || "mouvement à préciser"}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-sourdine">
                      {manque && <span className="text-alerte">À compléter : {manque}</span>}
                      {enCours(plan) && <span className="text-accent">Génération en cours…</span>}
                      {nbClips > 0 && (
                        <Link href={`/projets/${id}/clips#plan-${plan.id}`} className="lien">
                          {nbClips} clip{nbClips > 1 ? "s" : ""}
                          {plan.validated_take_id ? " · 1 validé" : ""} → Clips
                        </Link>
                      )}
                    </div>

                    <details>
                      <summary className="cursor-pointer text-sm font-semibold text-accent">Modifier ce plan</summary>
                      <div className="mt-3">
                        <FormulairePlan projectId={id} plan={plan} photoUrl={photo} />
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
