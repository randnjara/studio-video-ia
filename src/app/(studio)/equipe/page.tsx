import { redirect } from "next/navigation";
import { requireProfile, type Profile } from "@/lib/session";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { CLE_ENDPOINT_PHOTO, CLE_ENDPOINT_VOIX, CLE_VOLUME, PRIX_SECONDE_VOIX, endpointEco } from "@/lib/runpod";
import {
  CLE_CACHE_PHOTO,
  CLE_CACHE_VIDEO,
  depenseRunPodMois,
  PRIX_VOLUME_MOIS_USD,
  SERVEURS_CACHE,
  TAILLE_VOLUME_GO,
} from "@/lib/runpod-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { CLE_ARRET_SERVEUR, lireArretServeur } from "@/lib/file-attente";
import { arreterServeur, redemarrerServeur } from "../projets/[id]/file-actions";
import {
  ajouterStockageEco,
  changerAcces,
  creerServeursCacheAction,
  passerAuCache,
  changerRole,
  creerServeurEco,
  creerServeurVoixAction,
  fixerBudget,
  inviterMembre,
  reinitialiserConnexion,
  renvoyerLien,
  supprimerMembre,
} from "./actions";
import { LienConnexion } from "./lien-connexion";

const ERREURS: Record<string, string> = {
  "email-vide": "Saisissez l'adresse e-mail de la personne à inviter.",
  invitation: "L'invitation n'a pas pu être envoyée.",
  "soi-meme": "Vous ne pouvez pas changer votre propre accès ni votre propre rôle.",
  budget: "Saisissez un montant en dollars, par exemple 25.",
  serveur: "Le serveur RunPod n'a pas pu être créé.",
  "serveur-voix": "Le serveur voix n'a pas pu être créé.",
  stockage: "Le stockage du modèle n'a pas pu être ajouté.",
  membre: "Membre introuvable.",
  renvoi: "Le lien n'a pas pu être envoyé.",
  quota:
    "Limite des e-mails gratuits atteinte (quelques e-mails par heure). Utilisez « Créer un lien de connexion à copier », ou réessayez dans une heure.",
  reinitialisation: "La connexion n'a pas pu être réinitialisée.",
  confirmer: "Cochez la case de confirmation avant de supprimer.",
  suppression: "Le compte n'a pas pu être supprimé.",
  "confirmer-cache": "Cochez la case de confirmation.",
  "cache-absent": "Créez d'abord les deux serveurs (étape 1).",
  "suppression-disque":
    "Le studio utilise bien les nouveaux serveurs, mais l'ancien serveur ou le disque n'a pas pu être supprimé chez RunPod. Supprimez-les dans la console RunPod (Serverless et Storage).",
};

const EVENEMENTS: Record<string, string> = {
  "lien-demande": "a demandé un lien par e-mail",
  "erreur-envoi-lien": "erreur à l'envoi du lien",
  "lien-refuse": "lien refusé (expiré ou déjà utilisé)",
  "connexion-reussie": "connexion réussie",
  "lien-cree-par-responsable": "lien à copier créé par",
  "lien-envoye-par-responsable": "lien renvoyé par e-mail par",
  "compte-cree-sans-email": "compte créé sans e-mail (limite atteinte) par",
};

const date = (d?: string | null) =>
  d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Indian/Antananarivo" }) : "jamais";

// Appareil lisible à partir de l'en-tête du navigateur
function appareil(ua: string) {
  if (!ua) return "";
  const systeme = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const nav = /FBAN|FBAV/.test(ua) ? "Facebook" : /GSA\//.test(ua) ? "Google" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [systeme, nav].filter(Boolean).join(" · ") || ua.slice(0, 40);
}

const ACTIONS: Record<string, string> = {
  creation: "a créé le projet",
  corbeille: "a mis à la corbeille un projet",
  invitation: "a invité",
  desactivation: "a désactivé un compte",
  reactivation: "a réactivé un compte",
  budget: "a fixé le budget du mois",
  role: "a changé le rôle d'un membre",
  "lien-connexion": "a créé un lien de connexion pour",
  "renvoi-lien": "a renvoyé un lien à",
  reinitialisation: "a réinitialisé la connexion d'un membre",
  suppression: "a supprimé le compte",
  restauration: "a restauré un projet",
  ajout: "a ajouté un plan",
  import: "a importé des plans",
  generation: "a lancé une génération",
  validation: "a validé une vidéo",
  "validation-scenario": "a validé un scénario",
  "creation-serveur": "a créé le serveur de génération économique",
  "creation-stockage": "a ajouté le stockage du modèle chez RunPod",
  refus: "a refusé les clips d'un plan",
};

export default async function Equipe({
  searchParams,
}: {
  searchParams: Promise<{
    erreur?: string;
    detail?: string;
    invite?: string;
    budget?: string;
    serveur?: string;
    stockage?: string;
    renvoye?: string;
    reinitialise?: string;
    supprime?: string;
    cache?: string;
    "passe-cache"?: string;
    "sans-email"?: string;
    membre?: string;
    file?: string;
    voix?: string;
  }>;
}) {
  const sp = await searchParams;
  const { erreur, detail, invite, budget, serveur, stockage, renvoye, reinitialise, supprime } = sp;
  const { supabase, profile } = await requireProfile();
  if (profile.role !== "responsable") redirect("/");

  const now = new Date();
  const mois = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: membres }, { data: budgetMois }, { data: depense }, { data: journal }, endpoint, { data: volume }, runpod] =
    await Promise.all([
    supabase.from("profiles").select("id, display_name, role, active").order("created_at"),
    supabase.from("monthly_budgets").select("limit_usd").eq("month", mois).maybeSingle(),
    supabase.rpc("month_spend_usd"),
    supabase
      .from("activity_log")
      .select("id, action, details, created_at, actor_id")
      .order("created_at", { ascending: false })
      .limit(15),
    endpointEco(),
    supabase.from("reglages").select("valeur").eq("cle", CLE_VOLUME).maybeSingle(),
    depenseRunPodMois(),
  ]);

  // Détails de connexion (clé secrète) : e-mail, dates, appareils connectés, dernières tentatives
  const [comptes, { data: sessions }, { data: tentatives }] = await Promise.all([
    (async () => (await createAdminClient().auth.admin.listUsers({ perPage: 200 })).data?.users ?? [])().catch(() => []),
    supabase.rpc("sessions_membres"),
    supabase
      .from("journal_connexion")
      .select("id, email, evenement, detail, appareil, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const { data: reglagesCache } = await supabase
    .from("reglages")
    .select("cle, valeur")
    .in("cle", [CLE_CACHE_VIDEO, CLE_CACHE_PHOTO, CLE_ENDPOINT_PHOTO, CLE_ENDPOINT_VOIX, CLE_ARRET_SERVEUR]);
  const reglage = (c: string) => reglagesCache?.find((x) => x.cle === c)?.valeur ?? null;
  const cacheVideo = reglage(CLE_CACHE_VIDEO);
  const cachePhoto = reglage(CLE_CACHE_PHOTO);
  const serveurPhoto = reglage(CLE_ENDPOINT_PHOTO);
  const serveurVoix = reglage(CLE_ENDPOINT_VOIX);
  const serveurArrete = Boolean(lireArretServeur(reglage(CLE_ARRET_SERVEUR))?.arrete);

  const compte = new Map(comptes.map((u) => [u.id, u]));
  const session = new Map(
    ((sessions ?? []) as { user_id: string; sessions: number; derniere_activite: string }[]).map((x) => [x.user_id, x]),
  );

  const noms = new Map((membres ?? []).map((m) => [m.id, m.display_name]));
  const limite = budgetMois ? Number(budgetMois.limit_usd) : null;
  const depenseMois = Number(depense ?? 0);
  const part = limite ? Math.min(100, Math.round((depenseMois / limite) * 100)) : 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Équipe et budget</h1>

      {invite && <p className="message-ok">Invitation envoyée à {invite}.</p>}
      {budget && <p className="message-ok">Budget du mois enregistré.</p>}
      {renvoye && <p className="message-ok">Lien envoyé par e-mail à {renvoye}.</p>}
      {reinitialise && (
        <p className="message-ok">Connexion réinitialisée : le membre est déconnecté de tous ses appareils.</p>
      )}
      {supprime && <p className="message-ok">Compte {supprime} supprimé. Ses projets restent dans le studio.</p>}
      {serveur && (
        <p className="message-ok">
          Serveur économique créé. Le premier clip prendra quelques minutes de plus, le temps que le serveur télécharge le
          modèle.
        </p>
      )}
      {stockage && (
        <p className="message-ok">
          Stockage du modèle ajouté. Le prochain clip remplit ce disque (un peu plus long), ensuite les démarrages sont
          plus rapides.
        </p>
      )}
      {sp["sans-email"] && (
        <p className="message-ok">
          Limite des e-mails gratuits atteinte : le compte de {sp["sans-email"]} est créé sans e-mail. Dans sa fiche
          ci-dessous, cliquez sur « Créer un lien de connexion à copier » et envoyez-lui ce lien (WhatsApp, Messenger…).
        </p>
      )}
      {sp["passe-cache"] && (
        <p className="message-ok">
          Le studio utilise maintenant les deux serveurs avec cache gratuit. L'ancien serveur et le disque payant sont
          supprimés.
        </p>
      )}
      {erreur && ERREURS[erreur] && (
        <p className="message-erreur">
          {ERREURS[erreur]} {detail}
        </p>
      )}

      <section className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Budget GPU du mois</h2>
        <div>
          <div className="flex justify-between text-sm">
            <span>
              Dépensé : <b>{depenseMois.toFixed(2)} $</b>
            </span>
            <span className="text-sourdine">{limite === null ? "Aucune limite fixée" : `Limite : ${limite.toFixed(2)} $`}</span>
          </div>
          {limite !== null && (
            <div className="mt-2 h-2 rounded-full bg-fond">
              <div
                className={`h-2 rounded-full ${part >= 80 ? "bg-alerte" : "bg-accent"}`}
                style={{ width: `${part}%` }}
              />
            </div>
          )}
          {runpod && (
            <p className="mt-2 text-sm">
              Facturé réellement par RunPod ce mois : <b>{runpod.total.toFixed(2)} $</b>{" "}
              <span className="text-sourdine">
                (serveur {runpod.serveur.toFixed(2)} $, stockage {runpod.disque.toFixed(2)} $, avec une heure de retard)
              </span>
            </p>
          )}
          <p className="mt-2 text-sm text-sourdine">
            Quand la limite est atteinte, plus aucune vidéo ne peut être générée ce mois-ci, jusqu'à ce que vous l'augmentiez.
          </p>
        </div>
        <form action={fixerBudget} className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="limit_usd" className="etiquette">
              Limite du mois ($)
            </label>
            <input
              id="limit_usd"
              name="limit_usd"
              inputMode="decimal"
              defaultValue={limite ?? 25}
              className="champ w-32"
            />
          </div>
          <BoutonEnvoi enCours="Enregistrement…">Enregistrer la limite</BoutonEnvoi>
        </form>
      </section>

      <section className="carte flex flex-col gap-3">
        <h2 className="text-lg font-bold">Serveur de génération économique</h2>
        {endpoint ? (
          <>
            {sp.file === "serveur-arrete" && <p className="message-ok">Serveur arrêté : plus rien n'est facturé.</p>}
            {sp.file === "serveur-redemarre" && <p className="message-ok">Serveur redémarré : les files repartent.</p>}
            {sp.file === "serveur-erreur" && <p className="message-erreur">RunPod n'a pas accepté la demande. {sp.detail ?? ""}</p>}
            <p className="text-sm">
              {serveurArrete ? (
                <span className="pastille bg-alerte-doux text-alerte">Arrêté</span>
              ) : (
                <span className="pastille bg-succes-doux text-succes">Actif</span>
              )}{" "}
              Identifiant RunPod <code>{endpoint}</code>.
              Les choix « Économique 480p » et « Économique 720p » sont proposés dans l'onglet Plans de chaque projet.
            </p>
            {/* Interrupteur pour être sûr de ne plus rien payer : photos et vidéos en attente repartent au redémarrage */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="flex-1 text-sourdine">
                {serveurArrete
                  ? "Aucune machine ne peut s'allumer, rien n'est facturé. Les photos et vidéos en attente repartiront au redémarrage."
                  : "Le serveur ne coûte rien quand il ne calcule pas. Pour tout couper tout de suite (calculs en cours compris) :"}
              </span>
              {serveurArrete ? (
                <form action={redemarrerServeur.bind(null, "/equipe")}>
                  <BoutonEnvoi enCours="Redémarrage…">Redémarrer le serveur</BoutonEnvoi>
                </form>
              ) : (
                <form action={arreterServeur.bind(null, "/equipe")}>
                  <BoutonEnvoi
                    className="bouton-danger"
                    enCours="Arrêt chez RunPod…"
                    confirmer="Arrêter le serveur RunPod pour toute l'équipe ? Les calculs en cours sont coupés et remis dans la file, plus rien n'est facturé."
                  >
                    Arrêter le serveur
                  </BoutonEnvoi>
                </form>
              )}
            </div>
            {serveurPhoto ? (
              <p className="text-sm">
                <span className="pastille bg-succes-doux text-succes">Cache gratuit</span> Vidéo et photos sur deux
                serveurs, modèles gardés par RunPod sans frais de stockage. Serveur photo <code>{serveurPhoto}</code>.
              </p>
            ) : volume ? (
              <p className="text-sm">
                <span className="pastille bg-succes-doux text-succes">Modèles stockés</span> Disque RunPod{" "}
                <code>{volume.valeur}</code> de {TAILLE_VOLUME_GO} Go (vidéo Wan 2.2 et photos Qwen-Image-Edit), environ{" "}
                {PRIX_VOLUME_MOIS_USD.toFixed(2)} $ par mois.
              </p>
            ) : (
              <>
                <p className="text-sm text-sourdine">
                  Sans stockage, le serveur retélécharge le modèle après chaque pause (plusieurs minutes et environ 0,30 $
                  de plus sur le premier clip). Garder le modèle chez RunPod coûte environ {PRIX_VOLUME_MOIS_USD.toFixed(2)}{" "}
                  $ par mois.
                </p>
                <form action={ajouterStockageEco}>
                  <BoutonEnvoi enCours="Création du disque chez RunPod…">Garder le modèle chez RunPod</BoutonEnvoi>
                </form>
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-sm">
              Clé RunPod reçue par le site :{" "}
              {process.env.RUNPOD_API_KEY ? (
                <span className="pastille bg-succes-doux text-succes">Oui</span>
              ) : (
                <span className="pastille bg-alerte-doux text-alerte">
                  Non, ajoutez le secret RUNPOD_API_KEY dans Cloudflare
                </span>
              )}
            </p>
            <p className="text-sm text-sourdine">
              Notre propre serveur RunPod génère les clips environ 6 fois moins cher (≈ 0,05 $ le clip de 5 s en 480p) que le
              service tout prêt (0,30 $). Il ne coûte rien quand il ne tourne pas. Un clic le crée avec la clé RunPod déjà
              enregistrée.
            </p>
            <form action={creerServeurEco}>
              <BoutonEnvoi enCours="Création chez RunPod…">Créer le serveur économique</BoutonEnvoi>
            </form>
          </>
        )}
      </section>

      <section id="voix" className="carte flex scroll-mt-24 flex-col gap-3">
        <h2 className="text-lg font-bold">🎙 Serveur voix</h2>
        {sp.voix && (
          <p className="message-ok">
            Serveur voix créé. La toute première voix peut prendre 2 à 5 minutes (RunPod télécharge le serveur), les suivantes
            quelques secondes.
          </p>
        )}
        {serveurVoix ? (
          <p className="text-sm text-sourdine">
            Le studio voix utilise le serveur <code>{serveurVoix}</code>, sur une petite carte graphique (environ{" "}
            {(PRIX_SECONDE_VOIX * 60).toFixed(3)} $ par minute de calcul, rien quand il ne tourne pas). Il s&apos;arrête aussi avec
            « Arrêter le serveur ».
          </p>
        ) : (
          <>
            <p className="text-sm text-sourdine">
              Le studio voix (texte → voix en malgache et dans 25 autres langues, voix d&apos;une personne, transformation
              d&apos;un enregistrement) a son propre serveur RunPod, sur une petite carte graphique bien moins chère que celle des
              vidéos. Il ne coûte rien quand il ne tourne pas : une minute de voix revient à moins d&apos;un centime. La table de
              mixage, elle, est calculée par le navigateur et ne coûte rien.
            </p>
            {process.env.RUNPOD_API_KEY ? (
              <form action={creerServeurVoixAction}>
                <BoutonEnvoi enCours="Création chez RunPod…">Créer le serveur voix</BoutonEnvoi>
              </form>
            ) : (
              <p className="message-erreur">Ajoutez d&apos;abord la clé RUNPOD_API_KEY dans Cloudflare.</p>
            )}
          </>
        )}
      </section>

      {endpoint && !serveurPhoto && (
        <section id="cache" className="carte flex flex-col gap-3">
          <h2 className="text-lg font-bold">Passer au cache gratuit de RunPod</h2>
          <p className="text-sm text-sourdine">
            Au lieu du disque payant (≈ {PRIX_VOLUME_MOIS_USD.toFixed(2)} $ par mois), RunPod garde lui-même chaque modèle sur
            ses machines, sans frais de stockage. Il faut un serveur par modèle : un pour la vidéo, un pour les photos. Ils
            ne coûtent rien quand ils ne tournent pas.
          </p>
          {sp.cache && <p className="message-ok">Les deux serveurs sont créés. Passez à l'étape 2.</p>}
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
            <li>
              {cacheVideo && cachePhoto ? (
                <span>
                  Serveurs créés : vidéo <code>{cacheVideo}</code>, photo <code>{cachePhoto}</code>.
                </span>
              ) : (
                <form action={creerServeursCacheAction}>
                  <BoutonEnvoi enCours="Création chez RunPod…">Créer les deux serveurs</BoutonEnvoi>
                </form>
              )}
            </li>
            <li>
              Dans la console RunPod, indiquez le modèle de chaque serveur : ouvrez le serveur, « Manage » puis « Edit
              Endpoint », champ <b>Model</b>, puis « Save ».
              <ul className="mt-1 list-disc pl-5">
                {(["video", "photo"] as const).map((k) => {
                  const id = k === "video" ? cacheVideo : cachePhoto;
                  return (
                    <li key={k}>
                      {id ? (
                        <a
                          className="lien"
                          href={`https://console.runpod.io/serverless/user/endpoint/${id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {SERVEURS_CACHE[k].nom}
                        </a>
                      ) : (
                        SERVEURS_CACHE[k].nom
                      )}{" "}
                      → Model : <code className="select-all">{SERVEURS_CACHE[k].modele}</code>
                    </li>
                  );
                })}
              </ul>
            </li>
            <li>
              <form action={passerAuCache} className="flex flex-col gap-2">
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="confirmer" value="oui" className="mt-1" />
                  J'ai rempli le champ Model des deux serveurs. Le studio peut utiliser les nouveaux serveurs et supprimer
                  l'ancien serveur et le disque payant (définitif).
                </label>
                <div>
                  <BoutonEnvoi className="bouton" enCours="Passage en cours…">
                    Utiliser les nouveaux serveurs
                  </BoutonEnvoi>
                </div>
              </form>
            </li>
          </ol>
        </section>
      )}

      <section className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Membres</h2>
        <ul className="divide-y divide-ligne">
          {((membres ?? []) as Profile[]).map((m) => (
            <li key={m.id} id={`membre-${m.id}`} className="flex flex-wrap items-center gap-3 py-3">
              <span className="font-semibold">{m.display_name}</span>
              <span className="text-sm text-sourdine">{m.role === "responsable" ? "Responsable" : "Membre"}</span>
              {!m.active && <span className="rounded bg-fond px-2 py-0.5 text-xs font-semibold">Désactivé</span>}
              {m.id !== profile.id && (
                <div className="ml-auto flex items-center gap-2">
                  <form action={changerRole.bind(null, m.id, m.role === "responsable" ? "membre" : "responsable")}>
                    <BoutonEnvoi className="bouton-discret px-3 py-1 text-sm" enCours="…">
                      {m.role === "responsable" ? "Passer membre" : "Passer responsable"}
                    </BoutonEnvoi>
                  </form>
                  <form action={changerAcces.bind(null, m.id, !m.active)}>
                    <BoutonEnvoi className={m.active ? "bouton-danger" : "bouton-discret px-3 py-1 text-sm"} enCours="…">
                      {m.active ? "Désactiver" : "Réactiver"}
                    </BoutonEnvoi>
                  </form>
                </div>
              )}
              <FicheMembre
                ouverte={sp.membre === m.id}
                m={m}
                moi={m.id === profile.id}
                u={compte.get(m.id)}
                s={session.get(m.id)}
                tentatives={(tentatives ?? []).filter((t) => t.email && t.email === compte.get(m.id)?.email?.toLowerCase())}
              />
            </li>
          ))}
        </ul>
        <form action={inviterMembre} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label htmlFor="display_name" className="etiquette">
              Prénom
            </label>
            <input id="display_name" name="display_name" className="champ" />
          </div>
          <div>
            <label htmlFor="email" className="etiquette">
              E-mail
            </label>
            <input id="email" name="email" type="email" required className="champ" />
          </div>
          <BoutonEnvoi enCours="Envoi…">Inviter</BoutonEnvoi>
        </form>
      </section>

      <section className="carte">
        <details>
          <summary className="cursor-pointer text-lg font-bold">Journal des connexions</summary>
          <p className="mt-2 text-sm text-sourdine">
            Les 100 dernières tentatives de tout le monde, y compris les liens refusés dont l'adresse est inconnue. Heure de
            Madagascar.
          </p>
          {tentatives && tentatives.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {tentatives.map((t) => (
                <Tentative key={t.id} t={t} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sourdine">Rien pour l'instant.</p>
          )}
        </details>
      </section>

      <section className="carte">
        <h2 className="text-lg font-bold">Activité récente</h2>
        {journal && journal.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {journal.map((j) => (
              <li key={j.id}>
                <span className="text-sourdine">
                  {new Date(j.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                </span>{" "}
                <b>{noms.get(j.actor_id ?? "") ?? "Quelqu'un"}</b> {ACTIONS[j.action] ?? j.action}
                {j.details?.title ? ` « ${j.details.title} »` : ""}
                {j.details?.email ? ` ${j.details.email}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sourdine">Rien pour l'instant.</p>
        )}
      </section>
    </div>
  );
}

type TentativeConnexion = { id: number; email: string | null; evenement: string; detail: string; appareil: string; created_at: string };

function Tentative({ t }: { t: TentativeConnexion }) {
  const erreur = t.evenement.startsWith("erreur") || t.evenement === "lien-refuse";
  return (
    <li className={erreur ? "text-alerte" : ""}>
      <span className="text-sourdine">{date(t.created_at)}</span> {t.email ?? "adresse inconnue"} :{" "}
      {EVENEMENTS[t.evenement] ?? t.evenement} {t.detail}
      {t.appareil && <span className="text-xs text-sourdine"> ({appareil(t.appareil)})</span>}
    </li>
  );
}

// Détails et dépannage d'un membre, pour le responsable
function FicheMembre({
  ouverte,
  m,
  moi,
  u,
  s,
  tentatives,
}: {
  ouverte: boolean;
  m: Profile;
  moi: boolean;
  u?: { email?: string; invited_at?: string; email_confirmed_at?: string; last_sign_in_at?: string; created_at: string };
  s?: { sessions: number; derniere_activite: string };
  tentatives: TentativeConnexion[];
}) {
  return (
    <details className="w-full text-sm" open={ouverte}>
      <summary className="cursor-pointer text-sourdine">Détails et dépannage</summary>
      <div className="mt-3 flex flex-col gap-3 rounded-lg bg-surface-2 p-3">
        {u ? (
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
            <dt className="text-sourdine">E-mail</dt>
            <dd className="break-all">{u.email}</dd>
            <dt className="text-sourdine">Invité le</dt>
            <dd>{date(u.invited_at ?? u.created_at)}</dd>
            <dt className="text-sourdine">Première connexion</dt>
            <dd>{u.email_confirmed_at ? date(u.email_confirmed_at) : "pas encore (invitation non ouverte)"}</dd>
            <dt className="text-sourdine">Dernière connexion</dt>
            <dd>{date(u.last_sign_in_at)}</dd>
            <dt className="text-sourdine">Appareils connectés</dt>
            <dd>
              {s ? `${s.sessions}, dernière activité ${date(s.derniere_activite)}` : "aucun"}
            </dd>
            <dt className="text-sourdine">Accès</dt>
            <dd>{m.active ? "actif" : "désactivé (ne peut pas se connecter)"}</dd>
          </dl>
        ) : (
          <p className="text-alerte">
            Détails indisponibles : vérifiez le secret SUPABASE_SERVICE_ROLE_KEY dans Cloudflare.
          </p>
        )}

        <div>
          <p className="font-semibold">Dernières tentatives</p>
          {tentatives.length > 0 ? (
            <ul className="mt-1 flex flex-col gap-1">
              {tentatives.slice(0, 10).map((t) => (
                <Tentative key={t.id} t={t} />
              ))}
            </ul>
          ) : (
            <p className="text-sourdine">Aucune notée. Les liens refusés sans adresse sont dans le journal des connexions.</p>
          )}
        </div>

        {!moi && (
          <>
            <p className="font-semibold">Si la personne n'arrive pas à se connecter</p>
            <ol className="flex list-decimal flex-col gap-3 pl-5">
              <li>
                <span>Le plus sûr : un lien à lui envoyer vous-même, sans e-mail.</span>
                <div className="mt-1">
                  <LienConnexion userId={m.id} nom={m.display_name} />
                </div>
              </li>
              <li>
                <span>Ou renvoyer {u?.email_confirmed_at ? "un lien de connexion" : "l'invitation"} par e-mail.</span>
                <form action={renvoyerLien.bind(null, m.id)} className="mt-1">
                  <BoutonEnvoi className="bouton-discret px-3 py-1 text-sm" enCours="Envoi…">
                    Renvoyer par e-mail
                  </BoutonEnvoi>
                </form>
              </li>
              <li>
                <span>Si la session est bloquée : la déconnecter de tous ses appareils, puis lui envoyer un lien.</span>
                <form action={reinitialiserConnexion.bind(null, m.id)} className="mt-1">
                  <BoutonEnvoi className="bouton-discret px-3 py-1 text-sm" enCours="…">
                    Réinitialiser la connexion
                  </BoutonEnvoi>
                </form>
              </li>
            </ol>
            <form action={supprimerMembre.bind(null, m.id)} className="flex flex-wrap items-center gap-3 border-t border-ligne pt-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="confirmer" value="oui" />
                Supprimer définitivement le compte de {m.display_name} (ses projets restent)
              </label>
              <BoutonEnvoi className="bouton-danger" enCours="Suppression…">
                Supprimer
              </BoutonEnvoi>
            </form>
          </>
        )}
      </div>
    </details>
  );
}
