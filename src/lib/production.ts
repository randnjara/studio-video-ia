import type { SupabaseClient } from "@supabase/supabase-js";
import { avecMouvement } from "@/lib/categories";
import { journaliser } from "@/lib/journal";
import { type EtatFile, attente, lireEtatFile } from "@/lib/file-attente";
import { type Reference, referencesCitees } from "@/lib/photos";
import { MOTEURS, type Moteur, annulerJob, lancerGeneration, lancerPhotoRunPod, lireStatut } from "@/lib/runpod";

// Outils côté serveur partagés par les pages Plans, Clips et Montage.

export const BUCKET = "medias";

// Liens temporaires (1 h) pour afficher les photos et vidéos privées, en une seule requête
export async function signerLiens(supabase: SupabaseClient, chemins: (string | null | undefined)[]) {
  const uniques = [...new Set(chemins.filter((c): c is string => Boolean(c)))];
  const liens = new Map<string, string>();
  if (uniques.length === 0) return liens;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(uniques, 60 * 60);
  for (const s of data ?? []) if (s.path && s.signedUrl) liens.set(s.path, s.signedUrl);
  return liens;
}

// Le statut affiché sur la liste des projets suit l'avancement réel
export async function majStatutProjet(supabase: SupabaseClient, projectId: string) {
  const [{ data: projet }, { count }, { data: montages }] = await Promise.all([
    supabase.from("projects").select("status").eq("id", projectId).single(),
    supabase.from("scenes").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("montages").select("status").eq("project_id", projectId),
  ]);
  if (!projet || projet.status === "livre" || projet.status === "archive") return;
  const statuts = (montages ?? []).map((m) => m.status);
  const statut = statuts.includes("valide")
    ? "valide"
    : statuts.includes("a_valider")
      ? "a_valider"
      : statuts.length > 0
        ? "montage"
        : (count ?? 0) > 0
          ? "production"
          : "scenario";
  if (statut !== projet.status) await supabase.from("projects").update({ status: statut }).eq("id", projectId);
}

// Un projet tout neuf passe en « production » dès son premier plan (une seule requête)
export async function marquerEnProduction(supabase: SupabaseClient, projectId: string) {
  await supabase.from("projects").update({ status: "production" }).eq("id", projectId).eq("status", "scenario");
}

// Ajouté à chaque consigne de mouvement : le visage et la tenue ne doivent pas changer pendant l'animation
// MAMAN 2 : en enchaînant les clips, le visage rajeunissait et changeait (volume, yeux, couleur des cheveux)
const STABILITE =
  "Same person, same face and clothing throughout, subtle natural movements, natural blinking and breathing, no morphing, no sudden change of position. Keep the face identical to the first frame: same apparent age, wrinkles, skin tone, eye colour, hair colour and hairstyle; never rejuvenate, beautify or change ethnicity.";

// Visage remis d'aplomb avant chaque clip enchaîné. Chaque clip part de la dernière image du précédent : les petites
// erreurs du visage s'additionnaient d'un clip à l'autre (MAMAN 2 : une femme âgée devenue jeune et blonde en 1 min 30).
// Notre serveur photo reprend la dernière image telle quelle et ne corrige que le visage, d'après la photo du plan 1
// et la photo du personnage. Le numéro RunPod de l'essai porte ce préfixe pendant cette étape.
export const VISAGE = "visage:";
// Au-delà, RunPod abandonne la correction et le clip part de l'image non corrigée
const VISAGE_TTL_MS = 8 * 60 * 1000;
const PROMPT_VISAGE = [
  "Image 1 is a frame taken from a continuous film shot. Reproduce image 1 exactly: same framing, camera distance, pose, hands, gesture, facial expression, mouth shape, clothing, background, lighting direction and composition. Do not move, add or remove anything.",
  "Only restore the person's identity: the face, hair and skin must be exactly those of the person in image 2 (and image 3 if given): same face shape, apparent age, wrinkles, skin tone, eye colour, eyebrows, hairstyle and hair colour. Do not beautify, rejuvenate or change ethnicity.",
  "Match the colour grading, saturation and brightness of image 2, correcting any drift in tint or contrast.",
  "Photorealistic, natural skin texture, sharp face, one single full-frame image with no border and no text.",
].join("\n");

// Photo de départ d'un clip. Prise unique, dans toutes les catégories : chaque clip part de la dernière image du clip
// précédent (celui validé, sinon le dernier réussi), sur tout le film, même quand le plan continu change.
// « attendre » : le clip précédent est encore en cours, celui-ci partira après lui.
// Sans clip précédent réussi (ou avec le service « Qualité max », qui ne rend pas cette image) : la photo du plan.
// « consigne » : la consigne de mouvement à envoyer (avec le mouvement de caméra d'un changement de cadrage).
// Toutes les colonnes sont lues : sans la migration 0016, on garde simplement la photo du plan.
// « ligne » : le plan déjà lu en entier (évite une lecture par clip dans la file d'attente).
type LignePlan = {
  id: string;
  project_id: string;
  position: number;
  motion_prompt: string;
  cadrage?: string | null;
  duration_s?: number | string | null;
  plan_continu?: number | null;
};
export async function photoDeDepart(
  supabase: SupabaseClient,
  sceneId: string,
  photoDuPlan: string,
  ligne?: LignePlan,
): Promise<{ chemin: string; consigne: string; enchaine: boolean } | "attendre"> {
  const plan = ligne ?? ((await supabase.from("scenes").select("*").eq("id", sceneId).single()).data as LignePlan | null);
  const consigne = plan?.motion_prompt ?? "";
  const seule = { chemin: photoDuPlan, consigne, enchaine: false };
  if (!plan) return seule;
  const { data: prec } = await supabase
    .from("scenes")
    .select("*, takes!takes_scene_id_fkey(*)")
    .eq("project_id", plan.project_id)
    .lt("position", plan.position)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prec) return seule;
  type Essai = { id: string; status: string; created_at: string; last_frame_path?: string | null };
  const essais = ((prec.takes ?? []) as Essai[]).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const avecImage = essais.filter((t) => t.status === "terminee" && t.last_frame_path);
  const choisi = avecImage.find((t) => t.id === prec.validated_take_id) ?? avecImage[0];
  if (choisi)
    return {
      chemin: choisi.last_frame_path!,
      consigne: avecMouvement(consigne, prec.cadrage, plan.cadrage, Number(plan.duration_s) || 5),
      enchaine: true,
    };
  if (essais.some((t) => t.status === "en_cours")) return "attendre";
  return seule;
}

// Lien d'envoi de la dernière image d'un clip, rangée à côté de sa vidéo (seulement pour notre serveur)
async function lienDernierePhoto(supabase: SupabaseClient, projectId: string, essaiId: string) {
  const chemin = `${projectId}/essais/${essaiId}-fin.jpg`;
  const { data } = await supabase.storage.from(BUCKET).createSignedUploadUrl(chemin, { upsert: true });
  return data ? { chemin, uploadUrl: data.signedUrl } : undefined;
}

type Plan = {
  id: string;
  motion_prompt: string;
  image_path: string | null;
  consent_confirmed: boolean;
  duration_s: number;
  status: string;
};

// Lance une génération pour un plan déjà chargé. Renvoie un code d'erreur, ou null si c'est parti.
export async function lancerPlan(
  supabase: SupabaseClient,
  auteurId: string,
  plan: Plan & LignePlan,
  format: string,
  moteur: Moteur,
) {
  if (!plan.image_path) return "sans-photo";
  if (!plan.motion_prompt) return "sans-prompt";
  if (!plan.consent_confirmed) return "sans-accord";

  const duree = Number(plan.duration_s) || 5;
  const seed = Math.floor(Math.random() * 2_000_000_000);

  // Le coût estimé est compté tout de suite, pour que le plafond du mois bloque à temps
  const { data: essai, error } = await supabase
    .from("takes")
    .insert({
      scene_id: plan.id,
      status: "en_cours",
      seed,
      cost_usd: (MOTEURS[moteur].prix5s * duree) / 5,
      moteur,
      resolution: moteur === "eco-480" ? "480p" : "720p",
      created_by: auteurId,
    })
    .select("id")
    .single();
  if (error || !essai) return error?.code === "P0001" ? "budget" : "essai";

  // Notre serveur : l'essai passe par la file, comme un lot. Elle attend la fin du clip précédent et remet le
  // visage d'aplomb avant d'envoyer la vidéo (la page Clips l'envoie dans les 10 secondes).
  if (moteur !== "qualite") {
    if (plan.status !== "validee") await supabase.from("scenes").update({ status: "en_generation" }).eq("id", plan.id);
    await journaliser(supabase, auteurId, "generation", "essai", essai.id, { scene_id: plan.id });
    return null;
  }

  try {
    // Prise unique : la dernière image du clip précédent ; s'il est encore en cours, la photo du plan
    const depart = await photoDeDepart(supabase, plan.id, plan.image_path, plan);
    const { data: signee, error: errSigne } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(depart === "attendre" ? plan.image_path : depart.chemin, 60 * 60);
    if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");

    // La vidéo sera rangée à côté des photos du projet ; notre serveur l'y dépose lui-même
    const projet = plan.image_path.split("/")[0];
    const videoPath = `${projet}/essais/${essai.id}.mp4`;
    let uploadUrl = "";
    if (moteur !== "qualite") {
      const { data: envoi, error: errEnvoi } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(videoPath, { upsert: true });
      if (errEnvoi || !envoi) throw new Error("Impossible de préparer l'envoi de la vidéo.");
      uploadUrl = envoi.signedUrl;
    }

    const jobId = await lancerGeneration({
      moteur,
      prompt: `${(depart === "attendre" ? plan.motion_prompt : depart.consigne).trim().replace(/[.\s]+$/, "")}. ${STABILITE}`,
      imageUrl: signee.signedUrl,
      format,
      duree,
      seed,
      videoPath,
      uploadUrl,
      dernierePhoto: moteur !== "qualite" ? await lienDernierePhoto(supabase, projet, essai.id) : undefined,
    });
    await Promise.all([
      supabase.from("takes").update({ runpod_job_id: jobId }).eq("id", essai.id),
      plan.status === "validee"
        ? null
        : supabase.from("scenes").update({ status: "en_generation" }).eq("id", plan.id),
    ]);
  } catch (e) {
    await supabase
      .from("takes")
      .update({
        status: "echouee",
        cost_usd: 0,
        error: e instanceof Error ? e.message : String(e),
        finished_at: new Date().toISOString(),
      })
      .eq("id", essai.id);
  }
  await journaliser(supabase, auteurId, "generation", "essai", essai.id, { scene_id: plan.id });
  return null;
}

// Envoi en lot par une file d'attente : Cloudflare limite chaque requête à 50 appels extérieurs, et lancer
// 34 vidéos d'un coup en demandait plus de 250. La demande inscrit les essais (sans numéro RunPod) ;
// chaque actualisation de la page en envoie quelques-uns et suit les autres.
const ENVOIS_PAR_APPEL = 3;
const SUIVIS_PAR_APPEL = 4;
const ENVOI = "envoi";
const ENVOI_MAX_MS = 3 * 60 * 1000;
// En prise unique, les clips partent un par un (chacun attend la dernière image du précédent) : 40 clips peuvent
// attendre leur tour plus de 2 h, l'attente permise est donc longue
const ATTENTE_MAX_MS = 6 * 60 * 60 * 1000;
// Annulations chez RunPod par clic sur « Arrêter le lot » (limite d'appels de Cloudflare) : au-delà, recliquer
export const ANNULATIONS_PAR_APPEL = 30;

// Inscrit un essai par plan dans la file (un seul appel). Renvoie le nombre inscrit, ou un code d'erreur.
export async function demanderEssais(
  supabase: SupabaseClient,
  auteurId: string,
  projectId: string,
  plans: Plan[],
  moteur: Moteur,
): Promise<{ inscrits: number; erreur: string | null }> {
  const prets = plans.filter((p) => p.image_path && p.motion_prompt && p.consent_confirmed);
  if (prets.length === 0) return { inscrits: 0, erreur: "selection-vide" };
  const { error } = await supabase.from("takes").insert(
    prets.map((plan) => {
      const duree = Number(plan.duration_s) || 5;
      return {
        scene_id: plan.id,
        status: "en_cours",
        seed: Math.floor(Math.random() * 2_000_000_000),
        // Le coût estimé est compté tout de suite, pour que le plafond du mois bloque à temps
        cost_usd: (MOTEURS[moteur].prix5s * duree) / 5,
        moteur,
        resolution: moteur === "eco-480" ? "480p" : "720p",
        created_by: auteurId,
      };
    }),
  );
  if (error) return { inscrits: 0, erreur: error.code === "P0001" ? "budget" : "essai" };
  await Promise.all([
    supabase
      .from("scenes")
      .update({ status: "en_generation" })
      .in(
        "id",
        prets.map((p) => p.id),
      )
      .neq("status", "validee"),
    journaliser(supabase, auteurId, "generation", "projet", projectId, { nombre: prets.length, moteur }),
  ]);
  return { inscrits: prets.length, erreur: null };
}

type EssaiEnCours = {
  id: string;
  scene_id: string;
  runpod_job_id: string | null;
  moteur: Moteur;
  sceneValidee: boolean;
  created_at: string;
};

async function echecEssai(supabase: SupabaseClient, essai: EssaiEnCours, erreur: string) {
  // RunPod ne facture pas les générations ratées
  await supabase
    .from("takes")
    .update({ status: "echouee", cost_usd: 0, error: erreur, finished_at: new Date().toISOString() })
    .eq("id", essai.id)
    .eq("status", "en_cours");
  if (!essai.sceneValidee) {
    // Le plan revient « à valider » s'il a déjà une autre vidéo réussie, sinon « brouillon »
    const { count } = await supabase
      .from("takes")
      .select("id", { count: "exact", head: true })
      .eq("scene_id", essai.scene_id)
      .eq("status", "terminee");
    await supabase
      .from("scenes")
      .update({ status: count ? "a_valider" : "brouillon" })
      .eq("id", essai.scene_id);
  }
}

type LigneEnvoi = LignePlan & { image_path: string | null };

// Envoie à RunPod quelques essais en attente. Un clip enchaîné passe d'abord par la correction du visage (serveur
// photo) ; sans serveur photo ou si elle ne peut pas partir, la vidéo part directement.
async function envoyerEssais(
  supabase: SupabaseClient,
  projectId: string,
  enAttente: EssaiEnCours[],
  serveurEco: string | null,
  serveurPhoto: string | null,
) {
  if (enAttente.length === 0) return;
  const [{ data: projet }, { data: scenes }] = await Promise.all([
    supabase.from("projects").select("aspect_ratio").eq("id", projectId).single(),
    supabase
      .from("scenes")
      // Toutes les colonnes : le cadrage et le plan continu sont lus si la migration 0016 est passée
      .select("*")
      .in("id", [...new Set(enAttente.map((e) => e.scene_id))]),
  ]);
  const format = projet?.aspect_ratio ?? "16:9";
  // Prise unique : un clip attend la fin du précédent. Les clips d'un même lot ont la même date : on les range dans
  // l'ordre du film pour que le premier clip du plan passe avant ses suites, et on regarde un peu plus loin dans la
  // file (pas plus loin que le double : Cloudflare limite le nombre d'appels par requête).
  const place = (e: EssaiEnCours) => scenes?.find((s) => s.id === e.scene_id)?.position ?? 0;
  const regardes = [...enAttente]
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || place(a) - place(b))
    .slice(0, ENVOIS_PAR_APPEL * 2);
  let envoyes = 0;
  for (const essai of regardes) {
    if (envoyes >= ENVOIS_PAR_APPEL) break;
    const plan = scenes?.find((s) => s.id === essai.scene_id) as LigneEnvoi | undefined;
    const depart = plan?.image_path
      ? await photoDeDepart(supabase, plan.id, plan.image_path, plan)
      : null;
    if (depart === "attendre") continue; // reste dans la file, sans numéro RunPod
    const { data: pris } = await supabase
      .from("takes")
      .update({ runpod_job_id: ENVOI })
      .eq("id", essai.id)
      .is("runpod_job_id", null)
      .select("id, seed")
      .maybeSingle();
    if (!pris) continue; // déjà pris par une autre actualisation
    envoyes++;
    const seed = Number(pris.seed);
    try {
      if (!plan?.image_path || !depart) throw new Error("Photo introuvable dans le stockage.");
      if (essai.moteur !== "qualite" && !serveurEco) throw new Error("Notre serveur RunPod n'est pas encore créé.");
      if (depart.enchaine && essai.moteur !== "qualite" && serveurPhoto) {
        const visage = await lancerVisage(supabase, projectId, essai, plan, depart.chemin, seed, format, serveurPhoto).catch(() => null);
        if (visage) {
          const { data: gardee } = await supabase
            .from("takes")
            .update({ runpod_job_id: `${VISAGE}${visage}` })
            .eq("id", essai.id)
            .eq("status", "en_cours")
            .select("id");
          if (gardee?.length === 0) await annulerJob("photo", visage, serveurPhoto);
          continue;
        }
      }
      await lancerVideo(supabase, projectId, essai, plan, depart, seed, format, serveurEco, ENVOI);
    } catch (e) {
      await echecEssai(supabase, essai, (e instanceof Error ? e.message : String(e)).slice(0, 500));
    }
  }
}

// Correction du visage de la dernière image du clip précédent. Images données au serveur photo : cette dernière image,
// puis la photo du plan 1 (le bon visage, avec la lumière du film), puis la photo du personnage cité.
// Renvoie le numéro RunPod, ou null s'il n'y a rien pour corriger.
async function lancerVisage(
  supabase: SupabaseClient,
  projectId: string,
  essai: EssaiEnCours,
  plan: LigneEnvoi,
  derniereImage: string,
  seed: number,
  format: string,
  serveurPhoto: string,
): Promise<string | null> {
  const [{ data: premier }, { data: refs }] = await Promise.all([
    supabase
      .from("scenes")
      .select("image_path, image_description")
      .eq("project_id", projectId)
      .not("image_path", "is", null)
      .order("position")
      .limit(1)
      .maybeSingle(),
    supabase.from("film_refs").select("id, nom, genre, description, image_path").eq("project_id", projectId),
  ]);
  const description = `${premier?.image_description ?? ""} ${(plan as { image_description?: string }).image_description ?? ""}`;
  const personnages = referencesCitees(description, (refs ?? []) as Reference[]).filter((r) => r.genre === "personnage");
  const visages = [premier?.image_path, ...personnages.map((r) => r.image_path)].filter(
    (c): c is string => Boolean(c) && c !== derniereImage,
  );
  if (visages.length === 0) return null;
  const imagePath = `${projectId}/essais/${essai.id}-visage.jpg`;
  const chemins = [derniereImage, ...visages].slice(0, 3);
  const [{ data: envoi }, { data: liens }] = await Promise.all([
    supabase.storage.from(BUCKET).createSignedUploadUrl(imagePath, { upsert: true }),
    supabase.storage.from(BUCKET).createSignedUrls(chemins, 60 * 60),
  ]);
  const urls = chemins.map((c) => liens?.find((l) => l.path === c)?.signedUrl).filter(Boolean) as string[];
  if (!envoi || urls.length < 2) return null;
  return lancerPhotoRunPod({
    prompt: PROMPT_VISAGE,
    referenceUrls: urls,
    format,
    seed,
    imagePath,
    uploadUrl: envoi.signedUrl,
    serveur: serveurPhoto,
    ttlMs: VISAGE_TTL_MS,
  });
}

// Envoie la vidéo d'un essai, depuis « depart.chemin ». « avant » : son numéro RunPod actuel, pour ne pas écraser
// un arrêt du lot survenu pendant l'envoi.
async function lancerVideo(
  supabase: SupabaseClient,
  projectId: string,
  essai: EssaiEnCours,
  plan: LigneEnvoi,
  depart: { chemin: string; consigne: string },
  seed: number,
  format: string,
  serveurEco: string | null,
  avant: string,
) {
  const duree = Number(plan.duration_s) || 5;
  // La vidéo sera rangée à côté des photos du projet ; notre serveur l'y dépose lui-même
  const videoPath = `${projectId}/essais/${essai.id}.mp4`;
  const notreServeur = essai.moteur !== "qualite";
  const [{ data: signee, error: errSigne }, envoi, dernierePhoto] = await Promise.all([
    supabase.storage.from(BUCKET).createSignedUrl(depart.chemin, 60 * 60),
    notreServeur ? supabase.storage.from(BUCKET).createSignedUploadUrl(videoPath, { upsert: true }) : Promise.resolve(null),
    notreServeur ? lienDernierePhoto(supabase, projectId, essai.id) : Promise.resolve(undefined),
  ]);
  if (errSigne || !signee) throw new Error("Photo introuvable dans le stockage.");
  if (envoi && (envoi.error || !envoi.data)) throw new Error("Impossible de préparer l'envoi de la vidéo.");
  const serveur = notreServeur ? (serveurEco ?? undefined) : undefined;
  const jobId = await lancerGeneration({
    moteur: essai.moteur,
    prompt: `${depart.consigne.trim().replace(/[.\s]+$/, "")}. ${STABILITE}`,
    imageUrl: signee.signedUrl,
    format,
    duree,
    seed,
    videoPath,
    uploadUrl: envoi?.data?.signedUrl ?? "",
    dernierePhoto,
    serveur,
  });
  const { data: gardee, error } = await supabase
    .from("takes")
    .update({ runpod_job_id: jobId })
    .eq("id", essai.id)
    .eq("status", "en_cours")
    .eq("runpod_job_id", avant)
    .select("id");
  if (error) throw new Error(error.message);
  // Lot arrêté pendant l'envoi : la vidéo ne doit pas tourner (et être facturée) sans personne pour la suivre
  if (gardee?.length === 0) await annulerJob(essai.moteur, jobId, serveur);
}

// Visage corrigé (ou correction ratée) : la vidéo part, depuis l'image corrigée si elle est là, sinon la dernière image
async function apresVisage(
  supabase: SupabaseClient,
  projectId: string,
  essai: EssaiEnCours,
  imageCorrigee: string | null,
  serveurEco: string | null,
) {
  const [{ data: plan }, { data: projet }] = await Promise.all([
    supabase.from("scenes").select("*").eq("id", essai.scene_id).single(),
    supabase.from("projects").select("aspect_ratio").eq("id", projectId).single(),
  ]);
  const ligne = plan as LigneEnvoi | null;
  if (!ligne?.image_path) throw new Error("Photo introuvable dans le stockage.");
  const depart = await photoDeDepart(supabase, ligne.id, ligne.image_path, ligne);
  if (depart === "attendre") throw new Error("Le clip précédent a été relancé : relancez ce plan.");
  const { data: prise } = await supabase.from("takes").select("seed").eq("id", essai.id).single();
  await lancerVideo(
    supabase,
    projectId,
    essai,
    ligne,
    { chemin: imageCorrigee ?? depart.chemin, consigne: depart.consigne },
    Number(prise?.seed ?? 0),
    projet?.aspect_ratio ?? "16:9",
    serveurEco,
    essai.runpod_job_id!,
  );
}

// Les essais à suivre à chaque actualisation, les plus anciens d'abord : RunPod traite sa file dans l'ordre, ce sont
// eux qui finissent en premier. En pause, on regarde aussi les plus récents, encore dans la file de RunPod, pour les
// y reprendre.
export function aSuivre<T extends { created_at: string }>(parties: T[], nombre: number, pause: boolean) {
  const tries = [...parties].sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (!pause) return tries.slice(0, nombre);
  return [...new Set([...tries.slice(0, nombre), ...tries.slice(-nombre)])];
}

// Envoie les essais en attente, demande à RunPod où en sont les autres et range les vidéos terminées.
// « envoyer » est faux pendant l'affichage de la page (déjà beaucoup d'appels) : l'envoi se fait par l'actualisation.
// En pause (ou serveur arrêté), rien ne part et les vidéos pas encore commencées reviennent dans la file.
// Renvoie le nombre d'essais encore en cours.
export async function suivreEssais(
  supabase: SupabaseClient,
  projectId: string,
  essais: EssaiEnCours[],
  envoyer = true,
  etatLu?: EtatFile,
) {
  if (essais.length === 0) return 0;
  const etat = etatLu ?? (await lireEtatFile(supabase, projectId));
  const age = (e: EssaiEnCours) => attente(etat, e.created_at);
  const bloque = (e: EssaiEnCours) => etat.enPause || (etat.serveurArrete && e.moteur !== "qualite");
  const serveurEco = etat.serveurVideo;
  const serveurPhoto = etat.serveurPhoto;
  const serveurDe = (e: EssaiEnCours) => (e.moteur === "qualite" ? undefined : (serveurEco ?? undefined));
  let finis = 0;

  // Coupé pendant l'envoi ou jamais envoyé (page fermée) : en échec, pour être relancé. En pause, l'attente est voulue.
  const perdus = essais.filter(
    (e) =>
      (e.runpod_job_id === ENVOI && age(e) > ENVOI_MAX_MS) ||
      (!e.runpod_job_id && !bloque(e) && age(e) > ATTENTE_MAX_MS),
  );
  for (const e of perdus)
    await echecEssai(supabase, e, e.runpod_job_id ? "Le lancement a été interrompu. Relancez ce plan." : "Vidéo jamais envoyée (page fermée). Relancez ce plan.");
  finis += perdus.length;
  if (envoyer)
    await envoyerEssais(
      supabase,
      projectId,
      essais.filter((e) => !e.runpod_job_id && !bloque(e) && age(e) <= ATTENTE_MAX_MS).sort((a, b) => a.created_at.localeCompare(b.created_at)),
      serveurEco,
      serveurPhoto,
    );

  // Remet un essai dans notre file (sans numéro RunPod), s'il n'a pas changé entre-temps
  const remettreEnFile = (essai: EssaiEnCours) =>
    supabase.from("takes").update({ runpod_job_id: null }).eq("id", essai.id).eq("runpod_job_id", essai.runpod_job_id!).eq("status", "en_cours");

  // Correction du visage en cours chez le serveur photo ; terminée (ou ratée), la vidéo part. En pause, elle attend.
  const suivreVisage = async (essai: EssaiEnCours) => {
    const job = essai.runpod_job_id!.slice(VISAGE.length);
    const statut = serveurPhoto ? await lireStatut("photo", job, serveurPhoto).catch(() => null) : null;
    if (serveurPhoto && !statut) return 0;
    if (statut?.etat === "en_cours") {
      if (statut.enFile && bloque(essai)) {
        await annulerJob("photo", job, serveurPhoto!);
        await remettreEnFile(essai);
      }
      return 0;
    }
    if (bloque(essai)) {
      if (statut?.etat === "echouee" && statut.annulee) await remettreEnFile(essai);
      return 0;
    }
    const corrigee =
      statut?.etat === "terminee" && statut.imagePath?.startsWith(`${projectId}/essais/`) ? statut.imagePath : null;
    try {
      await apresVisage(supabase, projectId, essai, corrigee, serveurEco);
      return 0;
    } catch (e) {
      await echecEssai(supabase, essai, (e instanceof Error ? e.message : String(e)).slice(0, 500));
      return 1;
    }
  };

  const parties = aSuivre(
    essais.filter((e) => e.runpod_job_id && e.runpod_job_id !== ENVOI),
    SUIVIS_PAR_APPEL,
    essais.some(bloque),
  );
  const resultats = await Promise.all(
    parties.map(async (essai) => {
      if (essai.runpod_job_id!.startsWith(VISAGE)) return suivreVisage(essai);
      let statut;
      try {
        statut = await lireStatut(essai.moteur, essai.runpod_job_id!, serveurDe(essai));
      } catch {
        return 0;
      }
      if (statut.etat === "en_cours") {
        // En pause : pas encore commencé chez RunPod, on le reprend pour qu'il ne parte pas
        if (statut.enFile && bloque(essai)) {
          await annulerJob(essai.moteur, essai.runpod_job_id!, serveurDe(essai));
          await remettreEnFile(essai);
        }
        return 0;
      }

      if (statut.etat === "echouee") {
        // Annulé par la pause ou l'arrêt du serveur : il repartira à la reprise
        if (statut.annulee && bloque(essai)) {
          await remettreEnFile(essai);
          return 0;
        }
        await echecEssai(supabase, essai, statut.erreur);
        return 1;
      }
      const chemin = `${projectId}/essais/${essai.id}.mp4`;
      if (statut.videoPath) {
        // Notre serveur a déjà déposé la vidéo : on vérifie seulement que c'est bien le chemin prévu
        if (statut.videoPath !== chemin) return 0;
      } else if (statut.videoUrl) {
        const video = await fetch(statut.videoUrl);
        if (!video.ok) return 0;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(chemin, await video.arrayBuffer(), { contentType: "video/mp4", upsert: true });
        if (error) return 0;
      } else return 0;
      const fin = {
        status: "terminee",
        video_path: chemin,
        gpu_seconds: statut.secondes,
        ...(statut.coutUsd !== null ? { cost_usd: statut.coutUsd } : {}),
        finished_at: new Date().toISOString(),
      };
      const garder = (champs: Record<string, unknown>) =>
        supabase.from("takes").update(champs).eq("id", essai.id).eq("status", "en_cours");
      // Dernière image gardée pour le clip suivant ; sans la migration 0016, la vidéo seule
      const enregistre = statut.dernierePhoto?.startsWith(`${projectId}/essais/`)
        ? await garder({ ...fin, last_frame_path: statut.dernierePhoto })
        : null;
      if (!enregistre || enregistre.error) await garder(fin);
      if (!essai.sceneValidee) await supabase.from("scenes").update({ status: "a_valider" }).eq("id", essai.scene_id);
      return 1;
    }),
  );
  return essais.length - finis - resultats.reduce<number>((n, r) => n + r, 0);
}

// « Arrêter le lot » : annule chez RunPod les vidéos parties et retire de la file celles qui attendaient
// (rien n'est facturé). Les vidéos déjà terminées restent. Renvoie le nombre arrêté et ceux à arrêter au clic suivant.
export async function arreterEssais(supabase: SupabaseClient, projectId: string) {
  const [{ data }, etat] = await Promise.all([
    supabase
      .from("takes")
      .select("id, scene_id, runpod_job_id, moteur, scenes!takes_scene_id_fkey!inner(project_id, status)")
      .eq("status", "en_cours")
      .eq("scenes.project_id", projectId),
    lireEtatFile(supabase, projectId),
  ]);
  const essais = data ?? [];
  const parties = essais.filter((e) => e.runpod_job_id && e.runpod_job_id !== ENVOI);
  const annulees = parties.slice(0, ANNULATIONS_PAR_APPEL);
  const restants = parties.slice(ANNULATIONS_PAR_APPEL).map((e) => e.id);
  await Promise.all(
    annulees.map((e) =>
      e.runpod_job_id!.startsWith(VISAGE)
        ? etat.serveurPhoto && annulerJob("photo", e.runpod_job_id!.slice(VISAGE.length), etat.serveurPhoto)
        : annulerJob(e.moteur as Moteur, e.runpod_job_id!, e.moteur === "qualite" ? undefined : (etat.serveurVideo ?? undefined)),
    ),
  );
  const arretes = essais.filter((e) => !restants.includes(e.id));
  if (arretes.length === 0) return { arretes: 0, restants: restants.length };
  await supabase
    .from("takes")
    .update({ status: "annulee", cost_usd: 0, error: "Arrêté à la demande.", finished_at: new Date().toISOString() })
    .in(
      "id",
      arretes.map((e) => e.id),
    )
    .eq("status", "en_cours");

  // Les plans reviennent « à valider » s'ils ont déjà une vidéo réussie, sinon « brouillon »
  const encore = new Set(essais.filter((e) => restants.includes(e.id)).map((e) => e.scene_id));
  const plans = [...new Set(arretes.map((e) => e.scene_id))].filter((id) => !encore.has(id));
  if (plans.length > 0) {
    const { data: reussis } = await supabase.from("takes").select("scene_id").in("scene_id", plans).eq("status", "terminee");
    const avecVideo = new Set((reussis ?? []).map((t) => t.scene_id));
    await Promise.all(
      [
        { status: "a_valider", ids: plans.filter((id) => avecVideo.has(id)) },
        { status: "brouillon", ids: plans.filter((id) => !avecVideo.has(id)) },
      ]
        .filter((g) => g.ids.length > 0)
        .map((g) => supabase.from("scenes").update({ status: g.status }).in("id", g.ids).eq("status", "en_generation")),
    );
  }
  return { arretes: arretes.length, restants: restants.length };
}
