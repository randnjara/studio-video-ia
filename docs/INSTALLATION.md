# Installation pas à pas

Trois services à régler : Supabase (comptes et base), Cloudflare (le site) et votre premier compte. Aucune commande à taper.

> Ne copiez jamais une clé secrète dans un message, un e-mail ou une discussion. Elles se collent uniquement dans les réglages de Supabase et de Cloudflare.

## 1. Supabase

1. Sur [supabase.com](https://supabase.com), créez un projet nommé `studio-video-ia`. Choisissez la région la plus proche (par exemple Frankfurt) et notez le mot de passe de la base dans un endroit sûr.
2. Menu **SQL Editor** → **New query**. Copiez tout le contenu du fichier `supabase/migrations/0001_init.sql`, collez-le, puis cliquez sur **Run**. Le message « Success » doit apparaître. Faites de même avec `supabase/migrations/0002_securite.sql`.
3. Menu **Authentication** → **Sign In / Providers** : laissez **Email** activé et **désactivez** « Allow new users to sign up ». Seules les personnes invitées pourront entrer.
4. Menu **Project Settings** → **API** : gardez cette page ouverte, vous aurez besoin de **Project URL**, de la clé **anon public** et de la clé **service_role** (secrète).

## 2. Cloudflare

1. Sur [dash.cloudflare.com](https://dash.cloudflare.com), menu **Workers & Pages** → **Create** → **Import a repository**. Connectez GitHub et choisissez `studio-video-ia`.
2. Réglages de construction :
   - Build command : `npx opennextjs-cloudflare build`
   - Deploy command : `npx opennextjs-cloudflare deploy`
3. Dans **Settings** → **Variables and Secrets**, ajoutez (à la fois en variables de construction et en variables d'exécution) :

   | Nom | Valeur | Type |
   | --- | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase | Texte |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé anon public | Texte |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé service_role | **Secret** (exécution seulement) |
   | `NEXT_PUBLIC_SITE_URL` | l'adresse du site, par exemple `https://studio-video-ia.votre-nom.workers.dev` | Texte |

4. Lancez le déploiement. Cloudflare affiche l'adresse du site.

À chaque modification du code sur la branche `main`, Cloudflare remet le site à jour tout seul.

## 3. Relier Supabase au site

Dans Supabase, menu **Authentication** → **URL Configuration** :

- **Site URL** : l'adresse du site Cloudflare.
- **Redirect URLs** : ajoutez `https://<adresse du site>/**` et `http://localhost:3000/**`.

## 4. Votre compte de responsable

Dans Supabase, menu **Authentication** → **Users** → **Invite user**, saisissez votre propre adresse e-mail. Le premier compte créé devient automatiquement **responsable**.

Ouvrez l'e-mail reçu et cliquez sur le lien : vous arrivez sur l'application. Ensuite, invitez les membres depuis la page **Équipe et budget**, sans repasser par Supabase.

## Vérifications

- [ ] Je me connecte et je vois « Responsable » en haut à droite.
- [ ] Je crée un projet dans « Mon espace » et un autre dans « Équipe ».
- [ ] J'invite un membre. Il voit le projet d'équipe, mais pas mon projet personnel.
- [ ] Je fixe un budget du mois sur la page Équipe et budget.

## Limites à connaître

- Le service d'e-mail gratuit de Supabase n'envoie que quelques e-mails par heure, en anglais, et ses modèles ne sont pas modifiables. C'est suffisant pour 4 personnes.
- Avec ces e-mails par défaut, un lien de connexion doit être ouvert dans le même navigateur que celui où il a été demandé. Les liens d'invitation, eux, marchent partout.
- Plus tard, on pourra brancher un service d'e-mail gratuit (par exemple Resend) : e-mails en français, sans limite gênante, et liens valables sur n'importe quel appareil (modèles pointant vers `/auth/confirm`).
- Un projet Supabase gratuit se met en pause après 7 jours sans aucune connexion. Il se réactive depuis le tableau de bord Supabase.
