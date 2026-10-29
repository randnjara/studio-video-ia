import { BoutonEnvoi } from "@/components/bouton-envoi";
import { type Onglet, arreterLot, arreterServeur, mettreEnPause, redemarrerServeur, reprendre } from "./file-actions";

const MESSAGES: Record<string, string> = {
  pause:
    "Pause : plus rien ne part au serveur. Ce qui est déjà en calcul se termine, vous pouvez le regarder et le tester. Cliquez sur « Reprendre » pour continuer.",
  reprise: "C'est reparti : la suite du lot part au serveur.",
  "serveur-arrete":
    "Serveur RunPod arrêté : aucune machine ne peut plus s'allumer, rien n'est facturé. Ce qui attendait reste dans la file et repartira au redémarrage.",
  "serveur-redemarre": "Serveur RunPod redémarré : la file repart toute seule.",
  "sans-serveur": "Il n'y a pas encore de serveur RunPod à arrêter.",
};

// Boutons du bandeau de génération : pause / reprise et arrêt du lot pour le projet,
// arrêt / redémarrage de nos serveurs RunPod pour toute l'équipe (responsable seulement).
export function ControleFile({
  projectId,
  onglet,
  enCours,
  enPause,
  serveurArrete,
  arretAuto,
  serveurExiste,
  responsable,
  sp,
}: {
  projectId: string;
  onglet: Onglet;
  enCours: number;
  enPause: boolean;
  serveurArrete: boolean;
  // Raison quand le studio a coupé le serveur tout seul (rien n'avançait chez RunPod)
  arretAuto?: string | null;
  serveurExiste: boolean;
  responsable: boolean;
  sp: Record<string, string | undefined>;
}) {
  const chemin = `/projets/${projectId}/${onglet}`;
  const message =
    sp.file === "arret"
      ? `${Number(sp.arretes) > 1 ? `${sp.arretes} générations arrêtées` : `${sp.arretes ?? 0} génération arrêtée`} (non facturé).${
          Number(sp.restants) > 0 ? ` Il en reste ${sp.restants} : cliquez encore sur « Arrêter le lot ».` : ""
        }`
      : sp.file
        ? MESSAGES[sp.file]
        : undefined;
  const visible = enCours > 0 || enPause || serveurArrete;

  return (
    <>
      {message && <p className="message-ok">{message}</p>}
      {sp.file === "serveur-erreur" && (
        <p className="message-erreur">RunPod n'a pas accepté la demande. {sp.detail ?? ""}</p>
      )}
      {visible && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ligne px-4 py-3 text-sm">
          <span className="flex-1 text-sourdine">
            {serveurArrete && arretAuto
              ? `${arretAuto} Rien n'est plus facturé. Ce qui attendait reste dans la file : redémarrez le serveur pour réessayer.`
              : serveurArrete
              ? "Serveur RunPod arrêté : rien ne part (sauf « Qualité max »), rien n'est facturé."
              : enPause
                ? "En pause : la suite du lot attend, sans rien coûter."
                : "Envie de tester ce qui est fait avant de continuer ? Mettez en pause."}
          </span>
          {enPause ? (
            <form action={reprendre.bind(null, projectId, onglet)}>
              <BoutonEnvoi className="bouton px-3 py-1.5" enCours="…">
                ▶ Reprendre
              </BoutonEnvoi>
            </form>
          ) : (
            enCours > 0 && (
              <form action={mettreEnPause.bind(null, projectId, onglet)}>
                <BoutonEnvoi className="bouton-discret px-3 py-1.5" enCours="…">
                  ⏸ Pause
                </BoutonEnvoi>
              </form>
            )
          )}
          {enCours > 0 && (
            <form action={arreterLot.bind(null, projectId, onglet)}>
              <BoutonEnvoi
                className="bouton-danger px-3 py-1.5"
                enCours="Arrêt…"
                confirmer="Arrêter le lot ? Les photos et vidéos pas encore terminées de ce projet sont annulées (non facturées). Celles déjà réussies restent."
              >
                ⏹ Arrêter le lot
              </BoutonEnvoi>
            </form>
          )}
          {responsable &&
            serveurExiste &&
            (serveurArrete ? (
              <form action={redemarrerServeur.bind(null, chemin)}>
                <BoutonEnvoi className="bouton px-3 py-1.5" enCours="Redémarrage…">
                  Redémarrer le serveur
                </BoutonEnvoi>
              </form>
            ) : (
              <form action={arreterServeur.bind(null, chemin)}>
                <BoutonEnvoi
                  className="bouton-danger px-3 py-1.5"
                  enCours="Arrêt chez RunPod…"
                  confirmer="Arrêter le serveur RunPod pour toute l'équipe ? Les calculs en cours sont coupés et remis dans la file, plus rien n'est facturé. Tout repartira quand vous le redémarrerez."
                >
                  Arrêter le serveur
                </BoutonEnvoi>
              </form>
            ))}
        </div>
      )}
    </>
  );
}
