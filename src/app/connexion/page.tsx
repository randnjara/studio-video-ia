import { envoyerLien } from "./actions";
import { SessionDepuisLien } from "./session-depuis-lien";

const MESSAGES: Record<string, string> = {
  "email-vide": "Saisissez votre adresse e-mail.",
  "non-invite": "Cette adresse n'a pas été invitée. Demandez une invitation au responsable de l'équipe.",
  "lien-invalide":
    "Ce lien n'a pas fonctionné. Il a peut-être expiré ou déjà servi, ou il a été ouvert dans un autre navigateur que celui de la demande. Demandez un nouveau lien.",
  "compte-inactif": "Votre accès a été désactivé. Contactez le responsable de l'équipe.",
  "trop-de-liens":
    "Trop de liens envoyés pour l'instant (limite des e-mails gratuits). Réessayez dans une heure, ou demandez au responsable un lien de connexion à copier depuis la page Équipe.",
  envoi: "Le lien n'a pas pu être envoyé.",
};

export default async function Connexion({
  searchParams,
}: {
  searchParams: Promise<{ envoye?: string; erreur?: string; detail?: string }>;
}) {
  const { envoye, erreur, detail } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-sm font-semibold tracking-wide text-accent uppercase">Studio Vidéo IA</p>
        <h1 className="mt-1 text-3xl font-bold">Connexion</h1>
        <p className="mt-2 text-sourdine">
          Recevez un lien de connexion par e-mail. Aucun mot de passe à retenir.
        </p>
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
        <form action={envoyerLien} className="carte flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="etiquette">
              Adresse e-mail
            </label>
            <input id="email" name="email" type="email" required autoComplete="email" className="champ" />
          </div>
          {erreur && MESSAGES[erreur] && <p className="text-sm text-alerte">{MESSAGES[erreur]} {detail}</p>}
          <button type="submit" className="bouton">
            Recevoir le lien
          </button>
        </form>
      )}
    </main>
  );
}
