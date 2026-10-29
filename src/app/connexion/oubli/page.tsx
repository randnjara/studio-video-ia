import Link from "next/link";
import { BoutonEnvoi } from "@/components/bouton-envoi";
import { demanderReinitialisation } from "../actions";

export default async function MotDePasseOublie({
  searchParams,
}: {
  searchParams: Promise<{ envoye?: string; erreur?: string }>;
}) {
  const { envoye, erreur } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">Studio Vidéo IA</p>
        <h1 className="mt-1 text-3xl font-bold">Mot de passe oublié</h1>
      </div>

      {envoye ? (
        <div className="carte flex flex-col gap-2">
          {envoye === "oui" ? (
            <p>
              Un lien pour choisir un nouveau mot de passe a été envoyé à l'adresse e-mail du compte (pensez aux spams). Il
              est valable une heure.
            </p>
          ) : (
            <p>L'e-mail n'a pas pu partir (limite des e-mails gratuits, ou pas d'adresse connue).</p>
          )}
          <p className="text-sourdine">
            Le responsable est aussi prévenu et peut vous donner un nouveau mot de passe par téléphone (WhatsApp ou SMS).
          </p>
          <Link href="/connexion" className="lien mt-2">
            Retour à la connexion
          </Link>
        </div>
      ) : (
        <form action={demanderReinitialisation} className="carte flex flex-col gap-4">
          <div>
            <label htmlFor="identifiant" className="etiquette">
              Nom d'utilisateur, e-mail ou téléphone
            </label>
            <input id="identifiant" name="identifiant" required autoCapitalize="none" className="champ" />
          </div>
          <div>
            <label htmlFor="telephone" className="etiquette">
              Numéro où vous joindre (facultatif)
            </label>
            <input id="telephone" name="telephone" type="tel" autoComplete="tel" className="champ" />
            <p className="mt-1 text-xs text-sourdine">Le responsable vous enverra le nouveau mot de passe à ce numéro.</p>
          </div>
          {erreur && <p className="text-sm text-alerte">Saisissez votre nom d'utilisateur.</p>}
          <BoutonEnvoi enCours="Envoi…">Demander un nouveau mot de passe</BoutonEnvoi>
          <Link href="/connexion" className="lien text-center text-sm">
            Retour à la connexion
          </Link>
        </form>
      )}
    </main>
  );
}
