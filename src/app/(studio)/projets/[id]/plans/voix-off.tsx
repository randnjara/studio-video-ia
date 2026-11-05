"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { lancerDecoupage, suivreDecoupage } from "./voix-off-actions";

type Creation = { id: string; nom: string; duree: number | null };

// Voix off → lip-sync : découpe la voix off du studio voix en un morceau par plan, puis envoie les plans au moteur
// « Lip-sync (voix off) ». La bouche suit le morceau ; la vidéo sort muette et la voix d'origine va sur sa piste au montage.
export function VoixOffLipsync({
  projectId,
  creations,
  nbPlans,
  nbDecoupes,
  nbMinutes,
  lipsync,
  auto,
  generer,
}: {
  projectId: string;
  creations: Creation[];
  nbPlans: number;
  nbDecoupes: number; // plans qui ont déjà leur morceau découpé
  nbMinutes: number; // plans dont le tableau donne le minutage (debut / fin)
  lipsync: boolean; // le serveur lip-sync existe
  auto: boolean; // tableau tout juste importé : la découpe part toute seule
  generer: (formData: FormData) => Promise<void>;
}) {
  const router = useRouter();
  const [creation, setCreation] = useState(creations[0]?.id ?? "");
  // Décoché par défaut : sans recalage, les plans sont pris bout à bout depuis 0, sans aucune mise à l'échelle
  const [recaler, setRecaler] = useState(false);
  const [etat, setEtat] = useState<{ enCours: boolean; message: string; erreur?: boolean }>({ enCours: false, message: "" });
  const arret = useRef(false);
  const lance = useRef(false);

  async function decouper() {
    if (!creation || etat.enCours) return;
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

  // Juste après l'import du tableau, avec une voix off terminée : la découpe part toute seule
  useEffect(() => {
    if (auto && !lance.current && creation && nbDecoupes < nbPlans) {
      lance.current = true;
      void decouper();
    }
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
      {creations.length === 0 ? (
        <p className="text-sm text-sourdine">
          Créez d&apos;abord la voix off dans le{" "}
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
                {creations.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom || "Voix"}
                    {c.duree ? ` · ${c.duree.toFixed(1)} s` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={recaler} onChange={(e) => setRecaler(e.target.checked)} className="accent-[var(--accent)]" />
              Recaler sur les silences si la durée réelle diffère (Whisper)
            </label>
            {etat.enCours ? (
              <button type="button" className="bouton-discret" onClick={() => (arret.current = true)}>
                Arrêter
              </button>
            ) : (
              <button type="button" className="bouton" onClick={decouper}>
                ✂ Découper la voix off
              </button>
            )}
          </div>
          <p className="text-xs text-sourdine">
            {nbDecoupes}/{nbPlans} plan{nbPlans > 1 ? "s" : ""} découpé{nbDecoupes > 1 ? "s" : ""} ·{" "}
            {nbMinutes > 0
              ? `minutage du tableau (debut / fin) pour ${nbMinutes} plan${nbMinutes > 1 ? "s" : ""}`
              : "pas de minutage dans le tableau : les durées des plans sont mises bout à bout"}
          </p>
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
