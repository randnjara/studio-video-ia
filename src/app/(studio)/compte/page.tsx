import { BoutonEnvoi } from "@/components/bouton-envoi";
import { LONGUEUR_MOT_DE_PASSE } from "@/lib/identifiant";
import { requireProfile } from "@/lib/session";
import { changerMotDePasse, modifierProfil } from "./actions";

const ERREURS: Record<string, string> = {
  format: "Nom d'utilisateur : 3 à 30 caractères, lettres minuscules sans accent, chiffres, point, tiret ou _.",
  pris: "Ce nom d'utilisateur est déjà pris.",
  profil: "Le profil n'a pas pu être enregistré.",
  court: `Le mot de passe doit faire au moins ${LONGUEUR_MOT_DE_PASSE} caractères.`,
  different: "Les deux mots de passe ne sont pas identiques.",
  "mot-de-passe": "Le mot de passe n'a pas pu être changé.",
};

export default async function Compte({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string; detail?: string; profil?: string; "mot-de-passe"?: string; nouveau?: string }>;
}) {
  const sp = await searchParams;
  const { profile } = await requireProfile();

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <h1 className="text-2xl font-bold tracking-tight">Mon compte</h1>

      {sp.nouveau && <p className="message-ok">Vous êtes connecté. Choisissez maintenant votre nouveau mot de passe.</p>}
      {sp.profil && <p className="message-ok">Profil enregistré.</p>}
      {sp["mot-de-passe"] && <p className="message-ok">Mot de passe changé. Utilisez-le à la prochaine connexion.</p>}
      {sp.erreur && ERREURS[sp.erreur] && (
        <p className="message-erreur">
          {ERREURS[sp.erreur]} {sp.detail}
        </p>
      )}

      <form action={changerMotDePasse} className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Mot de passe</h2>
        <input type="text" name="username" autoComplete="username" value={profile.username} readOnly hidden />
        <div>
          <label htmlFor="mot_de_passe" className="etiquette">
            Nouveau mot de passe
          </label>
          <input
            id="mot_de_passe"
            name="mot_de_passe"
            type="password"
            required
            minLength={LONGUEUR_MOT_DE_PASSE}
            autoComplete="new-password"
            className="champ"
          />
        </div>
        <div>
          <label htmlFor="confirmation" className="etiquette">
            Encore une fois
          </label>
          <input
            id="confirmation"
            name="confirmation"
            type="password"
            required
            minLength={LONGUEUR_MOT_DE_PASSE}
            autoComplete="new-password"
            className="champ"
          />
        </div>
        <div>
          <BoutonEnvoi enCours="Enregistrement…">Changer le mot de passe</BoutonEnvoi>
        </div>
      </form>

      <form action={modifierProfil} className="carte flex flex-col gap-4">
        <h2 className="text-lg font-bold">Profil</h2>
        <div>
          <label htmlFor="username" className="etiquette">
            Nom d'utilisateur (pour se connecter)
          </label>
          <input
            id="username"
            name="username"
            required
            defaultValue={profile.username}
            autoCapitalize="none"
            spellCheck={false}
            className="champ"
          />
        </div>
        <div>
          <label htmlFor="display_name" className="etiquette">
            Prénom affiché
          </label>
          <input id="display_name" name="display_name" defaultValue={profile.display_name} className="champ" />
        </div>
        <div>
          <label htmlFor="telephone" className="etiquette">
            Téléphone
          </label>
          <input
            id="telephone"
            name="telephone"
            type="tel"
            defaultValue={profile.telephone}
            placeholder="034 00 000 00"
            className="champ"
          />
          <p className="mt-1 text-xs text-sourdine">
            Sert à vous connecter et à recevoir un nouveau mot de passe du responsable si vous l'oubliez.
          </p>
        </div>
        <div>
          <BoutonEnvoi enCours="Enregistrement…">Enregistrer</BoutonEnvoi>
        </div>
      </form>
    </div>
  );
}
