import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { envoyerLien, seConnecter } from "./actions";
import { SessionDepuisLien } from "./session-depuis-lien";

const MESSAGES: Record<string, string> = {
  "champs-vides": "Saisissez votre nom d'utilisateur et votre mot de passe.",
  identifiants: "Nom d'utilisateur ou mot de passe incorrect.",
  "trop-d-essais": "Trop d'essais d'affilée. Patientez quelques minutes avant de réessayer.",
  "email-vide": "Saisissez votre adresse e-mail.",
  "non-invite": "Cette adresse n'a pas été invitée. Demandez une invitation au responsable de l'équipe.",
  "lien-invalide":
    "Ce lien n'a pas fonctionné. Il a peut-être expiré ou déjà servi. Connectez-vous avec votre mot de passe.",
  "compte-inactif": "Votre accès a été désactivé. Contactez le responsable de l'équipe.",
  "trop-de-liens":
    "Trop de liens envoyés pour l'instant (limite des e-mails gratuits). Connectez-vous plutôt avec votre mot de passe.",
  envoi: "Le lien n'a pas pu être envoyé.",
};

export default async function Connexion({
  searchParams,
}: {
  searchParams: Promise<{ envoye?: string; erreur?: string; detail?: string }>;
}) {
  const { envoye, erreur, detail } = await searchParams;
  const message = erreur && MESSAGES[erreur] && (
    <p className="text-sm text-alerte">
      {MESSAGES[erreur]} {detail}
    </p>
  );
  const erreurLien = erreur === "email-vide" || erreur === "non-invite" || erreur === "trop-de-liens" || erreur === "envoi";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">Studio Vidéo IA</p>
        <h1 className="mt-1 text-3xl font-bold">Connexion</h1>
      </div>

      <SessionDepuisLien />

      {envoye ? (
        <div className="carte">
          <p className="font-semibold">Lien envoyé à {envoye}.</p>
          <p className="mt-1 text-sourdine">
            Ouvrez l'e-mail et cliquez sur le lien, une seule fois. Il est valable une heure. Pensez à regarder dans les
            spams. Si vous demandez un autre lien, seul le dernier reçu fonctionne.
          </p>
        </div>
      ) : (
        <>
          <form action={seConnecter} className="carte flex flex-col gap-4">
            <div>
              <label htmlFor="identifiant" className="etiquette">
                Nom d'utilisateur
              </label>
              <input
                id="identifiant"
                name="identifiant"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="champ"
              />
              <p className="mt-1 text-xs text-sourdine">Ou votre e-mail, ou votre numéro de téléphone.</p>
            </div>
            <div>
              <label htmlFor="mot_de_passe" className="etiquette">
                Mot de passe
              </label>
              <input
                id="mot_de_passe"
                name="mot_de_passe"
                type="password"
                required
                autoComplete="current-password"
                className="champ"
              />
            </div>
            {!erreurLien && message}
            <BoutonEnvoi enCours="Connexion…">Se connecter</BoutonEnvoi>
            <Link href="/connexion/oubli" className="lien text-center text-sm">
              Mot de passe oublié ?
            </Link>
          </form>

          <details className="carte" open={erreurLien}>
            <summary className="cursor-pointer text-sm text-sourdine">Recevoir plutôt un lien par e-mail</summary>
            <form action={envoyerLien} className="mt-4 flex flex-col gap-4">
              <div>
                <label htmlFor="email" className="etiquette">
                  Adresse e-mail
                </label>
                <input id="email" name="email" type="email" required autoComplete="email" className="champ" />
              </div>
              {erreurLien && message}
              <BoutonEnvoi className="bouton-discret" enCours="Envoi…">
                Recevoir le lien
              </BoutonEnvoi>
            </form>
          </details>
        </>
      )}
    </main>
  );
}
