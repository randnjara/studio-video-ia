"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { avertissementsDuree } from "@/lib/voix-off-import";
import { ImportVoixOff } from "./import-voix-off";
import { lancerCalage, lancerDecoupage, suivreCalage, suivreDecoupage } from "./voix-off-actions";

type Creation = { id: string; nom: string; duree: number | null };

// Voix off → lip-sync : découpe la voix off du studio voix en un morceau par plan, puis envoie les plans au moteur
// « Lip-sync (voix off) ». La bouche suit le morceau ; la vidéo sort muette et la voix d'origine va sur sa piste au montage.
export function VoixOffLipsync({
  projectId,
  creations,
  nbPlans,
  nbDecoupes,
  nbMinutes,
  minutage,
  calePour,
  dejaCales,
  langueParDefaut,
  lipsync,
  auto,
  generer,
}: {
  projectId: string;
  creations: Creation[];
  nbPlans: number;
  nbDecoupes: number; // plans qui ont déjà leur morceau découpé
  nbMinutes: number; // plans dont le tableau donne le minutage (debut / fin)
  minutage: { debut: number; fin: number }[]; // plans bout à bout (ou minutage du tableau), pour comparer à la voix
  calePour: string | null; // voix off sur laquelle les plans sont calés (la seule source de minutage)
  dejaCales: string[]; // voix off déjà calées une fois (pas de nouveau calage automatique, par exemple après un retour arrière)
  langueParDefaut: string;
  lipsync: boolean; // le serveur lip-sync existe
  auto: boolean; // tableau tout juste importé : la découpe part toute seule
  generer: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [creation, setCreation] = useState(calePour ?? creations[0]?.id ?? "");
  // Durée de la voix choisie comparée à celle des plans (voix importée ou créée dans le studio voix)
  // Une fois calés sur l'audio, les plans ont la durée de la voix : plus d'avertissement de durée
  const avertissements = calePour === creation ? [] : avertissementsDuree(creations.find((c) => c.id === creation)?.duree ?? null, minutage);
  const [langue, setLangue] = useState(langueParDefaut);
  const [resultat, setResultat] = useState<Extract<Awaited<ReturnType<typeof suivreCalage>>, { etat: "terminee" }> | null>(null);
  const calages = useRef(new Set<string>(dejaCales));
  // Décoché par défaut : sans recalage, les plans sont pris bout à bout depuis 0, sans aucune mise à l'échelle
  const [recaler, setRecaler] = useState(false);
  const [etat, setEtat] = useState<{ enCours: boolean; message: string; erreur?: boolean }>({ enCours: false, message: "" });
  const arret = useRef(false);
  const lance = useRef(false);

  // Cale les plans sur la voix off audio (Whisper), réécrit le tableau, puis découpe la voix aux temps réels
  async function caler(id: string) {
    if (!id || etat.enCours) return;
    calages.current.add(id);
    arret.current = false;
    setResultat(null);
    setEtat({ enCours: true, message: "🎧 Calage des plans sur la voix off : Whisper écoute l'audio (1 à 3 min, plus si le serveur démarre)…" });
    const r: Awaited<ReturnType<typeof lancerCalage>> = await lancerCalage(projectId, id, langue).catch(() => ({ erreur: "Connexion perdue." }));
    if ("erreur" in r) return setEtat({ enCours: false, message: r.erreur, erreur: true });
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 4000));
      if (arret.current) return setEtat({ enCours: false, message: "Calage arrêté." });
      const s: Awaited<ReturnType<typeof suivreCalage>> = await suivreCalage(projectId, id, r.jobId).catch(() => ({ etat: "en_cours" as const }));
      if ("erreur" in s) return setEtat({ enCours: false, message: s.erreur, erreur: true });
      if (s.etat === "terminee") {
        setResultat(s);
        break;
      }
    }
    // La découpe et le lip-sync utilisent ensuite ces durées réelles
    await decouper(id, false);
  }

  async function decouper(id = creation, seul = true) {
    if (!id || (seul && etat.enCours)) return;
    const creation = id;
    arret.current = false;
    let depuis: number | null = 0;
    let faits = 0;
    let sansVoix = 0;
    let recale = false;
    const avertissements = new Set<string>();
    setEtat({ enCours: true, message: "Envoi au serveur voix…" });
    while (depuis !== null && !arret.current) {
      const r: Awaited<ReturnType<typeof lancerDecoupage>> = await lancerDecoupage(projectId, creation, recaler, depuis).catch(() => ({
        erreur: "Connexion perdue.",
      }));
      if ("erreur" in r) return setEtat({ enCours: false, message: r.erreur, erreur: true });
      // Plans après la fin de la voix off : comptés une fois (au premier lot)
      if (depuis === 0) sansVoix += r.sansVoix;
      setEtat({ enCours: true, message: `Découpe des plans ${depuis + 1} à ${Math.min(r.total, depuis + 20)} sur ${r.total}…` });
      // Le serveur voix peut mettre une minute à démarrer ; ensuite chaque lot prend quelques secondes
      for (;;) {
        await new Promise((ok) => setTimeout(ok, 3000));
        if (arret.current) return setEtat({ enCours: false, message: "Découpe arrêtée." });
        const s: Awaited<ReturnType<typeof suivreDecoupage>> = await suivreDecoupage(projectId, creation, r.jobId).catch(() => ({
          etat: "en_cours" as const,
        }));
        if ("erreur" in s) return setEtat({ enCours: false, message: s.erreur, erreur: true });
        if (s.etat === "terminee") {
          faits += s.morceaux;
          sansVoix += s.ignores;
          recale ||= s.recale;
          if (s.avertissement) avertissements.add(s.avertissement);
          break;
        }
      }
      depuis = r.suivant;
    }
    setEtat({
      enCours: false,
      message: [
        `${faits} morceau${faits > 1 ? "x" : ""} de voix off prêt${faits > 1 ? "s" : ""}${recale ? " (coupures recalées sur les silences)" : ""}.`,
        sansVoix > 0
          ? `${sansVoix} plan${sansVoix > 1 ? "s" : ""} sans voix : ${sansVoix > 1 ? "ils tombent" : "il tombe"} après la fin de cette voix off (pas de lip-sync pour ${sansVoix > 1 ? "eux" : "lui"}).`
          : "",
        ...avertissements,
      ]
        .filter(Boolean)
        .join(" "),
    });
    router.refresh();
  }

  // La voix off audio est la seule source de minutage : dès qu'elle est importée ou choisie, les plans sont calés dessus
  // (une seule fois par voix ; « 🎧 Caler » relance). Déjà calés mais pas encore découpés (tableau tout juste importé) :
  // la découpe part toute seule.
  useEffect(() => {
    if (!creation || etat.enCours) return;
    if (creation !== calePour && !calages.current.has(creation)) void caler(creation);
    else if (auto && !lance.current && creation === calePour && nbDecoupes < nbPlans) {
      lance.current = true;
      void decouper();
    }
  }, [creation]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      arret.current = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section id="voix-off" className="carte flex scroll-mt-24 flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">🎙 Voix off et lip-sync</h2>
        <p className="text-sm text-sourdine">
          Chaque plan reçoit son morceau de la voix off ; le moteur « Lip-sync » fait bouger la bouche exactement dessus. La vidéo
          sort muette : au montage, la voix off d&apos;origine est posée sur sa propre piste (volume, fondus, musique réglables
          sans rien regénérer).
        </p>
      </div>
      {/* Toujours visible : une voix off déjà finie (ElevenLabs, micro…) s'importe telle quelle et est choisie aussitôt */}
      <ImportVoixOff
        projectId={projectId}
        onImportee={(id) => {
          setCreation(id);
          router.refresh();
        }}
      />
      {creations.length === 0 ? (
        <p className="text-sm text-sourdine">
          Importez la voix off ci-dessus, ou créez-la dans le{" "}
          <a href={`/projets/${projectId}/voix`} className="lien">
            studio voix
          </a>
          .
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="etiquette mb-0">Voix off</span>
              <select className="champ" value={creation} onChange={(e) => setCreation(e.target.value)} disabled={etat.enCours}>
                {!creations.some((c) => c.id === creation) && <option value={creation}>Voix importée…</option>}
                {creations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom || "Voix"}
                    {c.duree ? ` · ${c.duree.toFixed(1)} s` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="etiquette mb-0">Langue parlée</span>
              <select className="champ" value={langue} onChange={(e) => setLangue(e.target.value)} disabled={etat.enCours}>
                <option value="mg">Malgache</option>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
                <option value="">Détection automatique</option>
              </select>
            </label>
            {calePour !== creation && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={recaler} onChange={(e) => setRecaler(e.target.checked)} className="accent-[var(--accent)]" />
                Recaler sur les silences (sans calage)
              </label>
            )}
            {etat.enCours ? (
              <button type="button" className="bouton-discret" onClick={() => (arret.current = true)}>
                Arrêter
              </button>
            ) : (
              <>
                <button type="button" className="bouton" onClick={() => void caler(creation)}>
                  🎧 Caler les plans sur la voix off
                </button>
                <button type="button" className="bouton-discret" onClick={() => void decouper()}>
                  ✂ Découper la voix off
                </button>
              </>
            )}
          </div>
          <p className="text-xs text-sourdine">
            {nbDecoupes}/{nbPlans} plan{nbPlans > 1 ? "s" : ""} découpé{nbDecoupes > 1 ? "s" : ""} ·{" "}
            {nbMinutes > 0
              ? `minutage du tableau (debut / fin) pour ${nbMinutes} plan${nbMinutes > 1 ? "s" : ""}`
              : "pas de minutage dans le tableau : les durées des plans sont mises bout à bout"}
          </p>
          <p className="text-xs">
            {calePour === creation
              ? "🎧 Plans calés sur cette voix off : chaque plan dure exactement sa réplique prononcée (avec la pause qui suit), la durée du film est celle de l'audio."
              : "La voix off audio est la seule source de minutage : choisir ou importer une voix cale automatiquement les plans dessus (les durées du tableau ne sont que des estimations)."}
          </p>
          {resultat && (
            <details className="rounded-lg border border-ligne p-3 text-sm" open>
              <summary className="cursor-pointer font-semibold">
                {resultat.resume.plans} plans calés sur {resultat.resume.duree.toFixed(1)} s de voix (estimés à {resultat.resume.estimee.toFixed(1)} s)
                {resultat.resume.scindes ? ` · ${resultat.resume.scindes} réplique(s) de plus de 5 s scindée(s)` : ""}
                {resultat.resume.nonTrouves ? ` · ${resultat.resume.nonTrouves} plan(s) non trouvé(s)` : " · 0 plan sans voix"}
                {resultat.resume.manquants ? ` · ${resultat.resume.manquants} mot(s) non trouvé(s)` : ""}
                {resultat.resume.aRefaire ? ` · ${resultat.resume.aRefaire} prompt(s) à refaire` : ""}
              </summary>
              <ol className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                {resultat.plans.map((p) => (
                  <li key={p.numero} className={p.statut === "non_trouve" || p.statut === "hors_voix" ? "text-alerte" : ""}>
                    Plan {p.numero} : {p.avant ? `${p.avant.toFixed(1)} s → ` : "nouveau · "}
                    {p.apres.toFixed(2)} s{p.scinde ? " · scindé" : ""}
                    {p.aRefaire ? " · ✏ prompt à refaire" : ""}
                    {p.statut === "non_trouve" ? " · réplique non trouvée dans l'audio" : p.statut === "sans_parole" ? " · plan muet" : ""}
                    {p.manquants.length ? ` · mots non trouvés : ${p.manquants.join(", ")}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {avertissements.length > 0 && <p className="rounded-lg bg-alerte/10 px-3 py-2 text-sm text-alerte">⚠ {avertissements.join(" ")}</p>}
          {etat.message && <p className={etat.erreur ? "message-erreur" : etat.enCours ? "text-sm" : "message-ok"}>{etat.message}</p>}
        </>
      )}
      {lipsync ? (
        nbDecoupes > 0 && (
          <form action={generer} className="flex flex-wrap items-center gap-3 border-t border-ligne pt-3">
            <input type="hidden" name="tous" value="1" />
            <input type="hidden" name="moteur" value="lipsync" />
            <BoutonEnvoi
              enCours="Envoi…"
              confirmer={`Générer en lip-sync les ${nbDecoupes} plan(s) qui ont leur voix off (sauf ceux déjà faits en lip-sync) ?`}
            >
              🗣 Générer toutes les scènes en lip-sync
            </BoutonEnvoi>
            <span className="text-xs text-sourdine">Environ 0,12 $ par plan de 5 s. Les plans sans morceau de voix sont laissés de côté.</span>
          </form>
        )
      ) : (
        <p className="text-xs text-sourdine">Le serveur lip-sync n&apos;est pas encore créé : le responsable le crée dans « Équipe et budget ».</p>
      )}
    </section>
  );
}
