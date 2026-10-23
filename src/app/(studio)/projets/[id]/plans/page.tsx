import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { GENRES, MOUVEMENT_PAR_DEFAUT, STATUTS_PLAN, couleurStatut, dureeLisible } from "@/lib/libelles";
import { alertesPlans } from "@/lib/controles";
import { suivrePhotos } from "@/lib/photos";
import { signerLiens } from "@/lib/production";
import { MOTEURS, PRIX_PHOTO_ESTIME_USD, endpointEco, moteursDisponibles } from "@/lib/runpod";
import { getClient } from "@/lib/session";
import { promptPreparation } from "@/lib/preparation";
import { promptVerification } from "@/lib/verification";
import {
  creerPhotos,
  deplacerPlan,
  enregistrerStyle,
  envoyerALaGeneration,
  restaurerScript,
  supprimerPlan,
  supprimerPlans,
  supprimerReference,
} from "./actions";
import { FormulairePlan } from "./formulaire-plan";
import { ImportGroupe } from "./import-groupe";
import { ImportTableau } from "./import-tableau";
import { BarreSelection } from "./selection";
import { CopierVerification } from "./copier-verification";
import { AjoutReference } from "./references";
import { SuiviPhotos } from "./suivi-photos";

type Plan = {
  id: string;
  position: number;
  motion_prompt: string;
  voiceover_text: string;
  image_description: string;
  image_path: string | null;
  cadrage: string;
  angle: string;
  lieu: string;
  intention: string;
  pose_debut: string;
  pose_fin: string;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
  validated_take_id: string | null;
  takes: { status: string }[];
  photos: Photo[];
};

type Photo = { id: string; status: string; error: string | null; runpod_job_id: string | null; created_at: string };
type Ref = { id: string; nom: string; genre: string; description: string; image_path: string };

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
  "sans-reference":
    "Aucune photo lancée : chaque description doit citer le nom d'au moins une référence du film (ex. : « Rova marche sur la Plage »).",
  "sans-serveur": "Créez d'abord notre serveur RunPod dans « Équipe et budget ».",
  photo: "La création des photos n'a pas pu démarrer. Réessayez.",
  reference: "La référence n'a pas pu être ajoutée : donnez-lui un nom et une photo.",
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
  const [{ data: projet }, { data }, { data: versions }, moteurs, { data: refsLues }, serveur] = await Promise.all([
    supabase.from("projects").select("title, aspect_ratio, scenario_text, style_text").eq("id", id).maybeSingle(),
    supabase
      .from("scenes")
      .select(
        "id, position, motion_prompt, voiceover_text, image_description, image_path, cadrage, angle, lieu, intention, pose_debut, pose_fin, consent_confirmed, duration_s, status, validated_take_id, takes!takes_scene_id_fkey(status), photos(id, status, error, runpod_job_id, created_at)",
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
    supabase.from("film_refs").select("id, nom, genre, description, image_path").eq("project_id", id).order("created_at"),
    endpointEco(),
  ]);
  const plans = (data ?? []) as Plan[];
  const refs = (refsLues ?? []) as Ref[];
  // Dernière demande de photo de chaque plan
  const dernierePhoto = (p: Plan) =>
    [...p.photos].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] as Photo | undefined;
  // Photos en cours : on demande des nouvelles au serveur à chaque affichage
  const photosEnCours = plans.flatMap((p) =>
    p.photos.filter((ph) => ph.status === "en_cours").map((ph) => ({ ...ph, scene_id: p.id })),
  );
  if (photosEnCours.length > 0) {
    await suivrePhotos(supabase, id, photosEnCours);
    const { data: maj } = await supabase
      .from("scenes")
      .select("id, image_path, photos(id, status, error, runpod_job_id, created_at)")
      .eq("project_id", id);
    for (const m of maj ?? []) {
      const p = plans.find((x) => x.id === m.id);
      if (p) Object.assign(p, { image_path: m.image_path, photos: m.photos });
    }
  }
  const nbPhotosEnCours = plans.reduce((n, p) => n + p.photos.filter((ph) => ph.status === "en_cours").length, 0);
  const liens = await signerLiens(supabase, [...plans.map((p) => p.image_path), ...refs.map((r) => r.image_path)]);

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
  const decrits = plans.filter((p) => p.image_description.trim()).length;
  const alertes = alertesPlans(plans, MOUVEMENT_PAR_DEFAUT);
  const nbAlertes = [...alertes.values()].reduce((n, a) => n + a.length, 0);
  const lieux = refs.filter((r) => r.genre === "lieu").map((r) => r.nom);

  return (
    <div className="flex flex-col gap-6">
      {sp.erreur && ERREURS[sp.erreur] && <p className="message-erreur">{ERREURS[sp.erreur]}</p>}
      {sp.ajoute && <p className="message-ok">Plan ajouté en bas du tableau.</p>}
      {sp.enregistre && <p className="message-ok">Plan enregistré.</p>}
      {sp.supprime && (
        <p className="message-ok">{Number(sp.supprime) > 1 ? `${sp.supprime} plans supprimés.` : "Plan supprimé."}</p>
      )}
      {sp.photos && Number(sp.photos) > 0 && (
        <p className="message-ok">
          {Number(sp.photos) > 1 ? `${sp.photos} photos de départ en création.` : "1 photo de départ en création."}
          {sp.sansref ? ` ${sp.sansref} plan(s) ignoré(s) : leur description ne cite aucune référence.` : ""}
        </p>
      )}
      {sp.reference && <p className="message-ok">Référence ajoutée.</p>}
      {sp.style && <p className="message-ok">Style du film enregistré.</p>}
      <SuiviPhotos projectId={id} enCours={nbPhotosEnCours} />
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
        <CopierVerification
          carte={false}
          titre="🤖 Préparer le tableau des plans avec ChatGPT (gratuit)"
          explication="Ajoutez d'abord les références du film (personnage principal, lieux) et le style, plus bas. Le bouton copie une consigne complète avec votre voix off (le script ci-dessus) : collez-la dans ChatGPT avec la photo du personnage. Il répond avec un tableau au format du studio ; enregistrez le bloc CSV dans un fichier .csv et importez-le juste en dessous."
          bouton="📋 Copier le prompt de préparation"
          texte={promptPreparation({
            titre: projet?.title ?? "",
            format: projet?.aspect_ratio ?? "16:9",
            style: projet?.style_text ?? "",
            script: projet?.scenario_text ?? "",
            refs,
          })}
        />
        <details className="rounded-lg border border-ligne p-4">
          <summary className="cursor-pointer font-semibold">📋 Importer un tableau de scènes (CSV ou scénario Markdown)</summary>
          <div className="mt-4">
            <ImportTableau projectId={id} />
          </div>
        </details>
        <details className="rounded-lg border border-ligne p-4">
          <summary className="cursor-pointer font-semibold">＋ Un seul plan</summary>
          <div className="mt-4">
            <FormulairePlan projectId={id} lieux={lieux} />
          </div>
        </details>
      </section>

      {/* Références du film : les photos de départ sont créées à partir d'elles, toutes avec les mêmes visages et décors */}
      <section className="carte flex flex-col gap-4" id="references">
        <div>
          <h2 className="text-lg font-bold">Références du film</h2>
          <p className="text-sm text-sourdine">
            Une photo par personnage, lieu ou objet important, avec un nom court. Dans la description de la photo de chaque plan,
            citez ces noms : notre serveur crée alors toutes les photos de départ d'un coup, avec les mêmes visages, vêtements et
            décors (3 références au plus par photo).
          </p>
        </div>
        {refs.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {refs.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={liens.get(r.image_path)} alt={r.nom} className="aspect-square w-full rounded-lg border border-ligne object-cover" />
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.nom}</span>
                  <form action={supprimerReference.bind(null, id, r.id)}>
                    <BoutonEnvoi className="lien text-xs" enCours="…" confirmer={`Retirer la référence « ${r.nom} » ?`}>
                      Retirer
                    </BoutonEnvoi>
                  </form>
                </div>
                <span className="text-xs text-sourdine">
                  {GENRES[r.genre] ?? r.genre}
                  {r.description ? ` · ${r.description}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg border border-ligne p-4" open={refs.length === 0}>
          <summary className="cursor-pointer font-semibold">＋ Ajouter une référence</summary>
          <div className="mt-4">
            <AjoutReference projectId={id} />
          </div>
        </details>
        <form action={enregistrerStyle.bind(null, id)} className="flex flex-col gap-2">
          <label className="etiquette" htmlFor="style-film">
            Style du film (ajouté à chaque photo)
          </label>
          <textarea
            id="style-film"
            name="style_text"
            rows={2}
            maxLength={600}
            defaultValue={projet?.style_text ?? ""}
            placeholder="Ex. : Madagascar années 1990, lumière chaude de fin de journée, couleurs douces, caméra 35 mm"
            className="champ text-sm"
          />
          <div>
            <BoutonEnvoi className="bouton-discret" enCours="Enregistrement…">
              Enregistrer le style
            </BoutonEnvoi>
          </div>
        </form>
        {!serveur && (
          <p className="text-sm text-sourdine">
            La création des photos utilise notre serveur RunPod : créez-le d'abord dans « Équipe et budget ».
          </p>
        )}
        {serveur && decrits === 0 && plans.length > 0 && (
          <p className="text-sm text-sourdine">
            Ajoutez une description de photo à vos plans (« Modifier ce plan »), puis cochez-les et cliquez sur « 🖼 Créer les
            photos ».
          </p>
        )}
      </section>

      {/* 2. Le tableau des plans, et l'envoi à la génération */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">Tableau des plans</h2>
          <span className="text-sm text-sourdine">
            {plans.length} plan{plans.length > 1 ? "s" : ""} · {dureeLisible(duree)} de vidéo au total
          </span>
        </div>

        {nbAlertes > 0 && (
          <p className="rounded-lg bg-alerte/10 px-4 py-3 text-sm text-alerte">
            ⚠ {nbAlertes} alerte{nbAlertes > 1 ? "s" : ""} sur les plans (gestes ou poses de fin répétés, voix off trop longue, consigne pas en
            anglais) : voyez le détail sous chaque plan avant de créer les photos ou les vidéos.
          </p>
        )}
        {plans.length > 0 && projet && <CopierVerification texte={promptVerification(projet, plans)} />}

        {plans.length === 0 ? (
          <p className="carte text-sm text-sourdine">Aucun plan pour l'instant. Créez-les ci-dessus.</p>
        ) : (
          <>
            <form id="selection" action={envoyerALaGeneration.bind(null, id)} className="carte sticky top-2 z-[5]">
              <BarreSelection
                moteurs={moteurs.map((m) => ({ id: m, ...MOTEURS[m] }))}
                prets={nouveaux}
                supprimer={supprimerPlans.bind(null, id)}
                creerPhotos={serveur ? creerPhotos.bind(null, id) : undefined}
                prixPhoto={PRIX_PHOTO_ESTIME_USD}
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
                const derniere = dernierePhoto(plan);
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
                        data-description={plan.image_description.trim() ? "1" : undefined}
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
                        {(plan.cadrage || plan.angle || plan.lieu || plan.intention) && (
                          <p className="mt-1 text-xs text-sourdine">
                            🎬 {[plan.cadrage, plan.angle, plan.lieu, plan.intention].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </div>

                    {alertes.get(plan.id) && (
                      <ul className="flex flex-col gap-1 rounded-md bg-alerte/10 px-3 py-2 text-xs text-alerte">
                        {alertes.get(plan.id)!.map((a) => (
                          <li key={a}>⚠ {a}</li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-sourdine">
                      {manque && <span className="text-alerte">À compléter : {manque}</span>}
                      {enCours(plan) && <span className="text-accent">Génération en cours…</span>}
                      {derniere?.status === "en_cours" && <span className="text-accent">🖼 Photo en création…</span>}
                      {derniere?.status === "echouee" && (
                        <span className="text-alerte" title={derniere.error ?? undefined}>
                          🖼 Photo ratée{derniere.error ? ` : ${derniere.error.slice(0, 120)}` : ""}
                        </span>
                      )}
                      {derniere?.status === "terminee" && <span>🖼 Photo créée par le studio</span>}
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
                        <FormulairePlan projectId={id} plan={plan} photoUrl={photo} lieux={lieux} />
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
