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
   | `NEXT_PUBLIC_SUPABASE_URL` | déjà dans `.env.production` | — |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | déjà dans `.env.production` | — |
   | `SUPABASE_SERVICE_ROLE_KEY` | clé service_role | **Secret** (exécution seulement) |
   | `NEXT_PUBLIC_SITE_URL` | l'adresse du site, par exemple `https://studio-video-ia.votre-nom.workers.dev` | Texte |
   | `RUNPOD_API_KEY` | clé RunPod (voir partie 5) | **Secret** (exécution seulement) |

4. Lancez le déploiement. Cloudflare affiche l'adresse du site.

À chaque modification du code sur la branche `main`, Cloudflare remet le site à jour tout seul.

## 3. Relier Supabase au site

Dans Supabase, menu **Authentication** → **URL Configuration** :

- **Site URL** : l'adresse du site Cloudflare.
- **Redirect URLs** : ajoutez `https://<adresse du site>/**` et `http://localhost:3000/**`.

## 4. Votre compte de responsable

Dans Supabase, menu **Authentication** → **Users** → **Invite user**, saisissez votre propre adresse e-mail. Le premier compte créé devient automatiquement **responsable**.

Ouvrez l'e-mail reçu et cliquez sur le lien : vous arrivez sur l'application. Ensuite, invitez les membres depuis la page **Équipe et budget**, sans repasser par Supabase.

## 5. Générer les vidéos (RunPod)

1. Créez un compte sur [runpod.io](https://www.runpod.io) et ajoutez au moins 10 $ de crédit (**Billing**).
2. Menu **Settings** → **API Keys** → **Create API Key**. Donnez-lui un nom (`studio`) et l'accès **All** (ou au minimum *Serverless : lecture et écriture*). Copiez la clé : elle ne s'affiche qu'une fois.
3. Dans Cloudflare, ouvrez le Worker `studio-video-ia` → **Settings** → **Variables and Secrets** → **Add**. Type **Secret**, nom `RUNPOD_API_KEY`, valeur : la clé copiée. Enregistrez (**Deploy**).

Le studio utilise le modèle Wan 2.2 image → vidéo déjà hébergé par RunPod : rien à installer, environ 0,30 $ par clip de 5 s en 720p, et les échecs ne sont pas facturés. Quand le volume augmentera, on pourra passer à notre propre machine RunPod, environ 5 fois moins chère par clip.

Photos et vidéos sont rangées dans le stockage Supabase (dossier privé `medias`, 1 Go gratuit, soit environ 200 clips). Cloudflare R2 prendra le relais plus tard pour les gros volumes.

## Vérifications

- [ ] Je me connecte et je vois « Responsable » en haut à droite.
- [ ] Je crée un projet dans « Mon espace » et un autre dans « Équipe ».
- [ ] J'invite un membre. Il voit le projet d'équipe, mais pas mon projet personnel.
- [ ] Je fixe un budget du mois sur la page Équipe et budget.
- [ ] Dans un projet, « Plans et vidéos » : j'ajoute un plan avec une photo et un mouvement, je clique « Générer la vidéo », la vidéo apparaît en 1 à 4 minutes.

## Limites à connaître

- Le service d'e-mail gratuit de Supabase n'envoie que quelques e-mails par heure, en anglais, et ses modèles ne sont pas modifiables. C'est suffisant pour 4 personnes.
- Avec ces e-mails par défaut, un lien de connexion doit être ouvert dans le même navigateur que celui où il a été demandé. Les liens d'invitation, eux, marchent partout.
- Plus tard, on pourra brancher un service d'e-mail gratuit (par exemple Resend) : e-mails en français, sans limite gênante, et liens valables sur n'importe quel appareil (modèles pointant vers `/auth/confirm`).
- Un projet Supabase gratuit se met en pause après 7 jours sans aucune connexion. Il se réactive depuis le tableau de bord Supabase.
