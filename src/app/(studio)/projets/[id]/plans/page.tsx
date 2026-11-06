import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { MOUVEMENT_PAR_DEFAUT, STATUTS_PLAN, couleurStatut, dureeLisible } from "@/lib/libelles";
import { lireCategorie, plansContinus } from "@/lib/categories";
import { alertesPlans } from "@/lib/controles";
import { minutageDeLAudio } from "@/lib/debit-voix";
import { risquesPlans } from "@/lib/risques";
import { lotsPromptsPhotos, suivrePhotos } from "@/lib/photos";
import { cleNom } from "@/lib/noms";
import { signerLiens } from "@/lib/production";
import { MOTEURS, PRIX_PHOTO_ESTIME_USD, endpointEco, endpointLipsync, moteursDisponibles } from "@/lib/runpod";
import { lireEtatFile } from "@/lib/file-attente";
import { requireProfile } from "@/lib/session";
import { type MinutageAudio, promptRefaireTableau, promptVerification } from "@/lib/verification";
import { garderDecor,
  creerPhotos,
  regenererPhoto,
  deplacerPlan,
  envoyerALaGeneration,
  appliquerCorrectionsRisques,
  restaurerScript,
  supprimerPlan,
  supprimerPlans,
} from "./actions";
import { FormulairePlan } from "./formulaire-plan";
import { ImportPhotos } from "./import-photos";
import { ImportGroupe } from "./import-groupe";
import { BarreSelection } from "./selection";
import { CopierLots } from "./copier-lots";
import { ImportCorrection } from "./import-correction";
import { CopierVerification } from "./copier-verification";
import { SuiviPhotos } from "./suivi-photos";
import { RemplacerPhoto } from "./remplacer-photo";
import { ControleFile } from "../controle-file";
import { VoixOffLipsync } from "./voix-off";
import { FriseTravail } from "@/components/frise-travail";
import { revenirAuTableau } from "./voix-off-actions";
import { promptARefaire } from "@/lib/calage";
import { minuter } from "@/lib/minutage";
import { PhotoZoom } from "@/components/photo-zoom";

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
  // Lignes de 5 s qui forment un seul plan à l'écran (absent tant que la migration 0016 n'est pas passée)
  plan_continu?: number | null;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
  validated_take_id: string | null;
  takes: { status: string }[];
  voice_clips?: { audio_path: string; duration_s: number | null; debut_s: number | null; fin_s: number | null; voix_creation_id: string | null }[];
  photos: Photo[];
};

type Photo = {
  id: string;
  status: string;
  error: string | null;
  runpod_job_id: string | null;
  created_at: string;
  // Remarques de « Re-générer » (absentes tant que la migration 0013 n'est pas passée)
  a_eviter?: string;
  voulu?: string;
};
type Ref = { id: string; nom: string; genre: string; description: string; image_path: string };

type Version = {
  id: number;
  created_at: string;
  data: {
    scenario_text?: string;
    // Tableau gardé avant un calage sur la voix off audio, et le résultat de ce calage
    tableau?: { id: string; duration_s: number | string; motion_prompt: string }[];
    calage?: {
      voix_creation_id: string;
      nom?: string;
      duree?: number;
      scindes?: string[];
      plans?: ({ id: string } & MinutageAudio)[];
    };
  };
};

const ERREURS: Record<string, string> = {
  plan: "Le plan n'a pas pu être enregistré. Réessayez.",
  "sans-photo": "Ajoutez une photo au plan avant de générer.",
  "sans-prompt": "Décrivez le mouvement voulu avant de générer.",
  "sans-accord": "Cochez la case d'accord des personnes photographiées avant de générer.",
  "sans-voix": "Lip-sync : aucun plan choisi n'a son morceau de voix off. Cliquez d'abord « Découper la voix off ».",
  budget: "Le plafond GPU du mois est atteint. Le responsable peut l'augmenter dans « Équipe et budget ».",
  essai: "La génération n'a pas pu démarrer. Réessayez.",
  import: "Les plans n'ont pas pu être créés. Réessayez.",
  "import-vide": "Ajoutez un script ou des photos avant de créer les plans.",
  "selection-vide": "Aucun plan à envoyer : cochez des plans qui ne sont pas déjà en génération.",
  "sans-reference":
    "Aucune photo lancée : chaque description doit citer le nom d'au moins une référence du film (ex. : « Rova marche sur la Plage »).",
  "sans-serveur": "Créez d'abord notre serveur RunPod dans « Équipe et budget ».",
  photo: "La création des photos n'a pas pu démarrer. Réessayez.",
  "serveur-arrete":
    "Notre serveur RunPod est arrêté : redémarrez-le (bouton du bandeau ou « Équipe et budget »), ou choisissez « Qualité max » pour les vidéos.",
  decor: "Ce plan n'a pas de lieu ou pas de photo : impossible de garder son décor.",
  "photos-importees": "Les photos n'ont pas pu être rattachées aux plans. Réessayez.",
  restauration: "Le tableau d'avant n'a pas pu être remis. Réessayez.",
  "import-audio": "Le tableau ne correspond pas aux répliques de la voix off audio.",
  "correction-risques": "Les corrections n'ont pas pu être enregistrées. Réessayez.",
  correction: "Les plans n'ont pas pu être mis à jour avec le tableau corrigé. Réessayez.",
  "sans-remarque": "Pour re-générer, écrivez en quelques mots ce qui ne va pas ou ce que vous voulez.",
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
  const { supabase, profile } = await requireProfile();

  // Le cadre du projet vérifie déjà la connexion et l'existence du projet : tout part en même temps
  const [{ data: projet }, { data }, { data: versions }, moteurs, { data: refsLues }, serveur, etat, { data: voixOff }, serveurLipsync] = await Promise.all([
    // Toutes les colonnes : la catégorie et le plan continu sont lus si la migration 0016 est passée
    supabase.from("projects").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("scenes")
      .select("*, takes!takes_scene_id_fkey(status), photos(*), voice_clips!voice_clips_scene_id_fkey(audio_path, duration_s, debut_s, fin_s, voix_creation_id)")
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
    lireEtatFile(supabase, id),
    // Voix off terminées du studio voix, à découper pour le lip-sync (sans la migration 0014, la liste reste vide)
    supabase
      .from("voix_creations")
      .select("id, nom, duree_s")
      .eq("project_id", id)
      .eq("status", "terminee")
      .order("created_at", { ascending: false }),
    endpointLipsync(),
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
    await suivrePhotos(supabase, id, photosEnCours, false, etat);
    const { data: maj } = await supabase
      .from("scenes")
      .select("id, image_path, photos(*)")
      .eq("project_id", id);
    for (const m of maj ?? []) {
      const p = plans.find((x) => x.id === m.id);
      if (p) Object.assign(p, { image_path: m.image_path, photos: m.photos });
    }
  }
  const nbPhotosEnCours = plans.reduce((n, p) => n + p.photos.filter((ph) => ph.status === "en_cours").length, 0);
  // Le lot en cours : depuis la plus ancienne photo en création, toutes les photos demandées ensemble
  const toutesPhotos = plans.flatMap((p) => p.photos);
  const depuisPhotos = toutesPhotos.filter((ph) => ph.status === "en_cours").map((ph) => ph.created_at).sort()[0] ?? "";
  const lotPhotos = depuisPhotos ? toutesPhotos.filter((ph) => ph.created_at >= depuisPhotos).length : 0;
  const liens = await signerLiens(supabase, plans.map((p) => p.image_path));

  const pret = (p: Plan) => Boolean(p.image_path && p.motion_prompt && p.consent_confirmed);
  const enCours = (p: Plan) => p.takes.some((t) => t.status === "en_cours");
  const nouveaux = plans.filter((p) => pret(p) && !enCours(p) && !p.takes.some((t) => t.status === "terminee")).length;
  const duree = plans.reduce((n, p) => n + Number(p.duration_s || 5), 0);
  // La voix off AUDIO est la seule source de minutage : plans calés dessus (minutage écrit par le calage Whisper)
  const caleSur = (p: Plan) => p.voice_clips?.find((v) => v.voix_creation_id && v.debut_s !== null)?.voix_creation_id ?? null;
  const parVoix = new Map<string, number>();
  for (const p of plans) {
    const v = caleSur(p);
    if (v) parVoix.set(v, (parVoix.get(v) ?? 0) + 1);
  }
  const [voixCalee, nbCales] = [...parVoix].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const calePour = voixCalee && nbCales >= Math.max(1, plans.length * 0.9) ? voixCalee : null;
  const listeVersions = (versions ?? []) as Version[];
  // Dernier calage sur cette voix : ancien tableau (prompts à refaire) et minutage lu dans l'audio
  const calage = calePour ? listeVersions.find((v) => v.data.calage?.voix_creation_id === calePour) : undefined;
  const avant = new Map((calage?.data.tableau ?? []).map((t) => [t.id, t]));
  const scindes = new Set(calage?.data.calage?.scindes ?? []);
  const aRefaire = new Set(plans.filter((p) => calePour && promptARefaire(p, avant, scindes)).map((p) => p.id));
  const minutageAudio = new Map((calage?.data.calage?.plans ?? []).map((m) => [m.id, m]));
  const refuses = plans.filter((p) => p.status === "refusee").length;
  // Résumé affiché quand le tableau est replié, et ouverture automatique après une action sur un plan
  const parStatut = Object.entries(
    plans.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {}),
  );
  const apercu = parStatut.map(([st, n]) => `${n} ${(STATUTS_PLAN[st] ?? st).toLowerCase()}`).join(" · ");
  const ouvert = Boolean(sp.ajoute || sp.enregistre || sp.importe || sp.refuse || sp.ouvert);
  const decrits = plans.filter((p) => p.image_description.trim()).length;
  // Minutage lu dans l'audio réel : pas d'alerte « voix off trop longue » (le texte est exactement ce qui est prononcé)
  const plansMinutes = plans.map((p) => ({ ...p, minutageAudio: minutageDeLAudio(p.voice_clips) }));
  const alertes = alertesPlans(plansMinutes, MOUVEMENT_PAR_DEFAUT, lireCategorie(projet?.categorie), Boolean(serveurLipsync));
  // Plans à risque (R1 à R7), du plus risqué au moins risqué, avec la correction proposée de prompt_video
  const risques = risquesPlans(plans, Boolean(serveurLipsync));
  const continus = plansContinus(plans);
  const categorie = lireCategorie(projet?.categorie);
  const nbAlertes = [...alertes.values()].reduce((n, a) => n + a.length, 0);
  const lieux = refs.filter((r) => r.genre === "lieu").map((r) => r.nom);
  // Lieux des plans sans photo de référence : le décor sera réinventé à chaque photo
  // (même lieu malgré majuscules, accents ou espaces différents : « JARDIN CELESTE » = « Jardin céleste »)
  const lieuxAvecPhoto = new Set(lieux.map(cleNom));
  const lieuxSansPhoto = new Map<string, string>();
  for (const p of plans) {
    const cle = cleNom(p.lieu);
    if (cle && !lieuxAvecPhoto.has(cle) && !lieuxSansPhoto.has(cle)) lieuxSansPhoto.set(cle, p.lieu.trim());
  }

  return (
    <div className="flex flex-col gap-6">
      {sp.erreur && ERREURS[sp.erreur] && (
        <p className="message-erreur">
          {ERREURS[sp.erreur]}
          {sp.detail ? ` ${sp.detail}` : ""}
        </p>
      )}
      {sp.ajoute && <p className="message-ok">Plan ajouté en bas du tableau.</p>}
      {sp["photos-importees"] && (
        <p className="message-ok">
          {Number(sp["photos-importees"]) > 1 ? `${sp["photos-importees"]} photos importées.` : "1 photo importée."} Vérifiez-les
          dans le tableau.
        </p>
      )}
      {sp.enregistre && <p className="message-ok">Plan enregistré.</p>}
      {sp.corriges && (
        <p className="message-ok">
          {Number(sp.corriges) > 1 ? `${sp.corriges} plans mis à jour` : `${sp.corriges} plan mis à jour`} avec le tableau
          corrigé.
          {sp.refaire ? ` Photos de départ à refaire : plans ${sp.refaire.split(",").join(", ")}.` : ""}
        </p>
      )}
      {sp.supprime && (
        <p className="message-ok">{Number(sp.supprime) > 1 ? `${sp.supprime} plans supprimés.` : "Plan supprimé."}</p>
      )}
      {sp.decor && (
        <p className="message-ok">Décor gardé : les prochaines photos de ce lieu reprendront cette pièce.</p>
      )}
      {lieuxSansPhoto.size > 0 && (
        <p className="message-erreur">
          {lieuxSansPhoto.size > 1 ? "Ces lieux n'ont" : "Ce lieu n'a"} pas de photo de référence : {[...lieuxSansPhoto.values()].join(", ")}.
          Sans elle, le décor change d'une photo à l'autre. En créant les photos ici, la première réussie dans ce lieu devient
          sa référence et les suivantes attendent pour reprendre le même décor. Vous pouvez aussi cliquer sur « Garder ce
          décor » sous une photo réussie, ou ajouter une photo du lieu à l'étape Infos.
        </p>
      )}
      {sp.photos && Number(sp.photos) > 0 && (
        <p className="message-ok">
          {Number(sp.photos) > 1 ? `${sp.photos} photos de départ en création.` : "1 photo de départ en création."}
          {sp.sansref ? ` ${sp.sansref} plan(s) ignoré(s) : leur description ne cite aucune référence.` : ""}
        </p>
      )}
      <SuiviPhotos
        projectId={id}
        enCours={nbPhotosEnCours}
        depuis={depuisPhotos}
        lot={lotPhotos}
        enPause={etat.enPause || etat.serveurArrete}
      />
      <ControleFile
        projectId={id}
        onglet="plans"
        enCours={nbPhotosEnCours + plans.filter(enCours).length}
        enPause={etat.enPause}
        serveurArrete={etat.serveurArrete}
        arretAuto={etat.arretAuto}
        serveurExiste={Boolean(etat.serveurVideo)}
        responsable={profile.role === "responsable"}
        sp={sp}
      />
      {sp["script-restaure"] && <p className="message-ok">Ancien script remis dans la zone de texte.</p>}
      {sp["corrige-audio"] && (
        <p className="message-ok">
          Tableau calé sur la voix off audio : {sp["corrige-audio"]} ligne(s) remise(s) au minutage et au texte de l&apos;audio.
        </p>
      )}
      {sp["tableau-restaure"] && <p className="message-ok">Tableau d&apos;avant le calage remis (durées et prompts d&apos;avant).</p>}
      {sp.corrige && (
        <p className="message-ok">
          {Number(sp.corrige) > 0 ? `${sp.corrige} prompt${Number(sp.corrige) > 1 ? "s" : ""} vidéo corrigé${Number(sp.corrige) > 1 ? "s" : ""}.` : "Aucun plan coché à corriger."}
        </p>
      )}
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

      {/* Autres façons d'ajouter des plans : la méthode conseillée est le tableau ChatGPT (étape 2) */}
      <section className="carte flex flex-col gap-4" id="script">
        <div>
          <h2 className="text-lg font-bold">Ajouter des plans à la main</h2>
          <p className="text-sm text-sourdine">
            Méthode conseillée : le tableau préparé par ChatGPT, à l'{" "}
            <Link href={`/projets/${id}/chatgpt`} className="lien">
              étape 2
            </Link>
            . Ici, vous pouvez aussi ajouter des plans vous-même : un plan = une photo + un mouvement + le texte de la voix off.
          </p>
        </div>
        <details className="rounded-lg border border-ligne p-4">
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
                      <span className="min-w-0 flex-1 truncate">
                        {v.data.tableau
                          ? `Tableau avant calage sur « ${v.data.calage?.nom || "la voix off"} » (${v.data.tableau.length} plans)`
                          : v.data.scenario_text?.slice(0, 90) || "(vide)"}
                      </span>
                      {v.data.tableau ? (
                        <form action={revenirAuTableau.bind(null, id, v.id)}>
                          <BoutonEnvoi className="lien" enCours="…" confirmer="Revenir à ce tableau (durées et prompts d'avant le calage) ?">
                            Revenir à ce tableau
                          </BoutonEnvoi>
                        </form>
                      ) : (
                        <form action={restaurerScript.bind(null, id, v.id)}>
                          <BoutonEnvoi className="lien" enCours="…">
                            Reprendre
                          </BoutonEnvoi>
                        </form>
                      )}
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
            <FormulairePlan projectId={id} lieux={lieux} />
          </div>
        </details>
      </section>

      {/* Photos de départ : créées par notre serveur RunPod, ou faites ailleurs puis importées d'un coup */}
      <section className="carte flex flex-col gap-4" id="references">
        <div>
          <h2 className="text-lg font-bold">Photos de départ : 2 façons</h2>
          <p className="text-sm">
            <span className="font-semibold">Photos de référence : </span>
            {refs.length ? refs.map((r) => r.nom).join(", ") : "aucune"}
            {" · "}
            <Link href={`/projets/${id}#references`} className="lien">
              modifier à l'étape 1
            </Link>
          </p>
        </div>
        {plans.length > 1 && (
          <p className="rounded-lg bg-accent-doux px-4 py-3 text-sm text-accent">
            Prise unique : une seule photo suffit pour tout le film, celle du plan 1. Chacun des {plans.length - 1} autres plans
            part de la dernière image du clip précédent. C'est pourquoi un seul plan (« plans 1 à 1 ») est proposé, même si
            tous sont cochés.
          </p>
        )}
        <details className="rounded-lg border border-ligne p-4">
          <summary className="cursor-pointer font-semibold">🖼 A. Créées par notre serveur RunPod (≈ {PRIX_PHOTO_ESTIME_USD} $ la photo)</summary>
          <div className="mt-3 flex flex-col gap-2 text-sm text-sourdine">
            {serveur ? (
              <p>
                Cochez les plans dans le tableau ci-dessous, puis cliquez sur « 🖼 Créer les photos ». Chaque photo part de la
                description du plan et des photos de référence qu'elle cite.
              </p>
            ) : (
              <p>Créez d'abord notre serveur RunPod dans « Équipe et budget ».</p>
            )}
            {decrits === 0 && plans.length > 0 && (
              <p>Aucun plan n'a de description de photo : importez le tableau ChatGPT (étape 2) ou modifiez les plans.</p>
            )}
          </div>
        </details>
        <details className="rounded-lg border border-ligne p-4" open={Boolean(sp["photos-importees"])}>
          <summary className="cursor-pointer font-semibold">📥 B. Faites ailleurs (ChatGPT, votre ordinateur…) puis importées</summary>
          <div className="mt-3 flex flex-col gap-4">
            {decrits > 0 && projet && (
              <CopierLots
                lots={lotsPromptsPhotos(
                  plans.map((p, i) => ({
                    numero: i + 1,
                    description: p.image_description,
                    cadrage: p.cadrage,
                    angle: p.angle,
                    lieu: p.lieu,
                    intention: p.intention,
                    pose_debut: p.pose_debut,
                  }))
                  // Prise unique : seule la première ligne a une photo, pas de prompt à copier pour les autres
                  .filter((_, i) => i === 0),
                  projet,
                  refs,
                )}
              />
            )}
            {plans.length > 0 ? (
              <ImportPhotos projectId={id} plans={plans.map((p, i) => ({ id: p.id, numero: i + 1, aPhoto: Boolean(p.image_path) }))} />
            ) : (
              <p className="text-sm text-sourdine">Créez d'abord les plans (étape 2).</p>
            )}
          </div>
        </details>
      </section>

      {plans.length > 0 && (
        <VoixOffLipsync
          projectId={id}
          creations={(voixOff ?? []).map((v) => ({ id: v.id, nom: v.nom, duree: v.duree_s !== null ? Number(v.duree_s) : null }))}
          nbPlans={plans.length}
          nbDecoupes={plans.filter((p) => p.voice_clips?.some((v) => v.audio_path && v.duration_s !== null)).length}
          nbMinutes={plans.filter((p) => p.voice_clips?.some((v) => v.debut_s !== null)).length}
          calePour={calePour}
          dejaCales={[...new Set(listeVersions.flatMap((v) => (v.data.calage ? [v.data.calage.voix_creation_id] : [])))]}
          langueParDefaut="mg"
          minutage={minuter(
            plans.map((p) => {
              const m = p.voice_clips?.find((v) => v.debut_s !== null);
              return {
                duree: Number(p.duration_s) || 5,
                debut: m?.debut_s !== null && m?.debut_s !== undefined ? Number(m.debut_s) : null,
                fin: m?.fin_s !== null && m?.fin_s !== undefined ? Number(m.fin_s) : null,
              };
            }),
          ).map(({ debut, fin }) => ({ debut, fin }))}
          lipsync={Boolean(serveurLipsync)}
          auto={Boolean(sp.importe)}
          generer={envoyerALaGeneration.bind(null, id)}
        />
      )}

      {/* 2. Le tableau des plans, et l'envoi à la génération */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-lg font-bold">Tableau des plans</h2>
          <span className="text-sm text-sourdine">
            {plans.length} plan{plans.length > 1 ? "s" : ""} · {dureeLisible(duree)} de vidéo au total
            {calePour ? " · 🎧 calé sur la voix off audio (durée du film = durée de l'audio)" : ""}
            {aRefaire.size ? ` · ✏ ${aRefaire.size} prompt${aRefaire.size > 1 ? "s" : ""} à refaire` : ""}
          </span>
        </div>

        {nbAlertes > 0 && (
          <p className="rounded-lg bg-alerte/10 px-4 py-3 text-sm text-alerte">
            ⚠ {nbAlertes} alerte{nbAlertes > 1 ? "s" : ""} sur les plans (gestes ou poses de fin répétés, voix off trop longue pour une durée estimée, consigne pas en
            anglais) : voyez le détail sous chaque plan avant de créer les photos ou les vidéos.
          </p>
        )}
        {risques.length > 0 && (
          <details id="risques" className="carte scroll-mt-24" open={Boolean(sp.corrige)}>
            <summary className="cursor-pointer text-sm font-semibold">
              ⚠ {risques.length} plan{risques.length > 1 ? "s" : ""} à risque (
              {risques.filter((r) => r.niveau === "élevé").length} élevé{risques.filter((r) => r.niveau === "élevé").length > 1 ? "s" : ""}) :
              recul de caméra, rire, émotion par la bouche, mains près du visage, parole dans le prompt…
            </summary>
            <form action={appliquerCorrectionsRisques.bind(null, id)} className="mt-3 flex flex-col gap-3">
              <ol className="flex flex-col gap-3 text-sm">
                {risques.map((r) => (
                  <li key={r.id} className="rounded-lg border border-ligne p-3">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        name="risques"
                        value={r.id}
                        defaultChecked={Boolean(r.correction)}
                        disabled={!r.correction}
                        className="mt-1 accent-[var(--accent)]"
                      />
                      <span className="flex flex-col gap-1">
                        <span>
                          <a href={`#plan-${r.id}`} className="lien font-semibold">
                            Plan {r.numero}
                          </a>{" "}
                          <span className={`pastille ${r.niveau === "élevé" ? "bg-alerte text-surface" : "bg-surface-2 text-sourdine"}`}>
                            risque {r.niveau} · {r.score}
                          </span>
                        </span>
                        <span className="text-sourdine">{r.raisons.map((x) => x.texte).join(" · ")}</span>
                        {r.correction ? (
                          <span className="text-xs">
                            Correction proposée de prompt_video : <i>{r.correction}</i>
                          </span>
                        ) : (
                          <span className="text-xs text-sourdine">Risque dans la pose ou l&apos;intention : corrigez-les à la main (ou avec la vérification ci-dessous).</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ol>
              <BoutonEnvoi enCours="Correction…" confirmer="Remplacer le prompt vidéo des plans cochés par la correction proposée ?">
                ✔ Appliquer les corrections proposées
              </BoutonEnvoi>
            </form>
          </details>
        )}
        {calePour && projet && (
          <CopierVerification
            titre="Refaire les prompts sur le minutage audio"
            bouton="📋 Copier la consigne pour refaire le tableau"
            explication={`Après le calage sur la voix off audio, ${aRefaire.size} plan(s) ont changé de durée de plus de 0,5 s : leurs repères « 0-1s / 1-3s… » ont été remis à l'échelle en attendant. Cette consigne donne à ChatGPT ou Claude, pour chaque plan, le texte réellement prononcé, le début et la fin réels, la durée, les pauses et le ton détecté, avec les règles anti-risques. Collez-la, puis importez le tableau rendu juste en dessous (« tableau corrigé ») : les prompts sont remplacés, le minutage audio est gardé.`}
            texte={promptRefaireTableau(
              projet,
              plans.map((p) => ({ ...p, aRefaire: aRefaire.has(p.id) })),
              plans.map((p) => {
                const m = minutageAudio.get(p.id);
                const v = p.voice_clips?.find((x) => x.voix_creation_id === calePour && x.debut_s !== null);
                return m ?? (v ? { debut: Number(v.debut_s), fin: Number(v.fin_s) } : null);
              }),
              lireCategorie(projet.categorie),
              calage?.data.calage?.nom ? `la voix off « ${calage.data.calage.nom} »` : undefined,
            )}
          />
        )}
        {plans.length > 0 && projet && (
          <CopierVerification
            texte={promptVerification(
              projet,
              plansMinutes,
              [...new Set(refs.filter((r) => r.genre === "produit").map((r) => r.nom))],
              lireCategorie(projet.categorie),
            )}
            explication="Le bouton copie une consigne complète avec votre script et le tableau de tous les plans. Collez-la dans ChatGPT ou Claude (joignez les photos de départ dans l'ordre si possible). L'assistant rend un fichier tableau_corrige.csv : importez-le juste en dessous pour mettre à jour les plans."
          />
        )}
        {plans.length > 0 && <ImportCorrection projectId={id} nbPlans={plans.length} avecPhoto={plans.flatMap((p, i) => (p.image_path ? [i + 1] : []))} />}

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
                const suite = i > 0;
                const continu = continus[i];
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
                      {continu.morceaux > 1 && (
                        <span className="pastille bg-accent-doux text-accent" title="Ces lignes forment un seul plan à l'écran, sans coupe">
                          🔗 Plan continu {continu.numero} · {continu.morceau}/{continu.morceaux}
                        </span>
                      )}
                      <span className={`pastille ${couleurStatut(plan.status)}`}>{STATUTS_PLAN[plan.status] ?? plan.status}</span>
                      {calePour && caleSur(plan) === calePour && (
                        <span className="pastille bg-surface-2 text-sourdine" title="Durée lue dans la voix off audio (Whisper)">
                          🎧 calé sur l&apos;audio · {Number(plan.duration_s).toFixed(2)} s
                        </span>
                      )}
                      {aRefaire.has(plan.id) && (
                        <span className="pastille bg-alerte/10 text-alerte" title="La durée a changé de plus de 0,5 s : le prompt vidéo est à refaire">
                          ✏ prompt à refaire
                        </span>
                      )}
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
                        <PhotoZoom src={photo} alt={`Photo du plan ${i + 1}`} className="aspect-video w-36 rounded-lg object-cover" />
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
                        {photo && plan.lieu && !lieuxAvecPhoto.has(cleNom(plan.lieu)) && (
                          <form action={garderDecor.bind(null, id, plan.id)} className="mt-1">
                            <BoutonEnvoi className="bouton-discret px-2 py-0.5 text-xs" enCours="…">
                              📌 Garder ce décor pour « {plan.lieu} »
                            </BoutonEnvoi>
                          </form>
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
                      {derniere?.status === "en_cours" && (
                        <span className="block w-full">
                          <FriseTravail jobId={derniere.runpod_job_id} enAttente="🖼 Photo en attente dans la file du studio…" compacte />
                        </span>
                      )}
                      {derniere?.status === "echouee" && (
                        <span className="text-alerte" title={derniere.error ?? undefined}>
                          🖼 Photo ratée{derniere.error ? ` : ${derniere.error.slice(0, 120)}` : ""}
                        </span>
                      )}
                      {derniere?.status === "terminee" && (
                        <span>
                          🖼 Photo créée par le studio
                          {/* Pour voir que chaque « Re-générer » a bien donné une nouvelle photo */}
                          {(() => {
                            const refaites = plan.photos.filter((ph) => ph.a_eviter || ph.voulu).length;
                            return refaites
                              ? ` · re-générée ${refaites} fois, la dernière à ${new Date(derniere.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Indian/Antananarivo" })}`
                              : "";
                          })()}
                        </span>
                      )}
                      {nbClips > 0 && (
                        <Link href={`/projets/${id}/clips#plan-${plan.id}`} className="lien">
                          {nbClips} clip{nbClips > 1 ? "s" : ""}
                          {plan.validated_take_id ? " · 1 validé" : ""} → Clips
                        </Link>
                      )}
                    </div>

                    {suite && (
                      <p className="text-xs text-sourdine">
                        Prise unique : ce clip part de la dernière image du clip précédent. Seule la photo du plan 1 compte.
                      </p>
                    )}
                    {!suite && derniere?.status !== "en_cours" && <RemplacerPhoto projectId={id} sceneId={plan.id} />}
                    {!suite && serveur && (photo || derniere) && plan.image_description.trim() && derniere?.status !== "en_cours" && (
                      <details open={sp.erreur === "sans-remarque" && sp.plan === plan.id}>
                        <summary className="cursor-pointer text-sm font-semibold text-accent">🔁 Re-générer cette photo</summary>
                        <form action={regenererPhoto.bind(null, id, plan.id)} className="mt-3 flex flex-col gap-3">
                          <p className="text-xs text-sourdine">
                            Le résultat ne vous plaît pas ? Dites en quelques phrases ce qui ne va pas et ce que vous voulez : ces
                            remarques sont ajoutées à la consigne de la nouvelle photo (≈ {PRIX_PHOTO_ESTIME_USD} $). Soyez précis
                            (ex. : « le visage est trop jeune », « elle doit tenir le téléphone dans la main droite »).
                          </p>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="etiquette">Ce qui ne va pas</span>
                            <textarea
                              name="a_eviter"
                              rows={2}
                              maxLength={600}
                              defaultValue={derniere?.a_eviter ?? ""}
                              placeholder="Ex. : deux personnes au lieu d'une, mains déformées, décor trop sombre"
                              className="champ text-sm"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-sm">
                            <span className="etiquette">Ce que vous voulez à la place</span>
                            <textarea
                              name="voulu"
                              rows={2}
                              maxLength={600}
                              defaultValue={derniere?.voulu ?? ""}
                              placeholder="Ex. : Mama seule, assise près de la fenêtre, lumière du matin, sourire léger"
                              className="champ text-sm"
                            />
                          </label>
                          <div>
                            <BoutonEnvoi enCours="Envoi…">🔁 Re-générer avec ces remarques</BoutonEnvoi>
                          </div>
                        </form>
                      </details>
                    )}

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
