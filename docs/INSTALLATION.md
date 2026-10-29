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

Le studio utilise le modèle Wan 2.2 image → vidéo déjà hébergé par RunPod : rien à installer, environ 0,30 $ par clip de 5 s en 720p, et les échecs ne sont pas facturés. Pour des clips moins chers, créez notre propre serveur RunPod (partie 6).

Photos et vidéos sont rangées dans le stockage Supabase (dossier privé `medias`, 1 Go gratuit, soit environ 200 clips). Cloudflare R2 prendra le relais plus tard pour les gros volumes.

## 6. Serveur de génération économique (RunPod)

Notre propre serveur fait tourner le même modèle Wan 2.2 en version rapide (4 étapes au lieu de 30). On paie seulement les secondes de GPU, autour de 0,05 $ par clip de 5 s en 480p au lieu de 0,30 $. Le code est dans le dossier `worker/` du dépôt.

Tout se fait depuis le studio, avec la clé `RUNPOD_API_KEY` déjà enregistrée dans Cloudflare :

1. GitHub construit l'image du serveur à chaque changement du dossier `worker/` (`.github/workflows/serveur-video.yml`) et la publie sur `ghcr.io/randnjara/studio-video-ia-worker`. Ce paquet doit être **public** pour que RunPod puisse le télécharger : GitHub → profil → **Packages** → `studio-video-ia-worker` → **Package settings** → **Change visibility** → **Public**.
2. Dans le studio, page **Équipe et budget** → **Créer le serveur économique**. Le serveur est créé chez RunPod avec des cartes de 80 Go (A100 ou H100), 0 machine allumée au repos, 2 au maximum, 30 s de maintien entre deux clips, et 150 Go de disque. Son identifiant est gardé dans la table `reglages`.

Dans l'onglet « Plans », la barre d'envoi propose alors trois choix : **Économique 480p**, **Économique 720p** et **Qualité max 720p**, qui garde le service tout prêt à 0,30 $.

Un démarrage « à froid » se produit au premier clip, puis après chaque pause. Le serveur télécharge alors le modèle, ce qui prend 2 à 5 minutes et ajoute environ 0,10 à 0,20 $ à ce clip. Il vaut donc mieux envoyer les plans par séries. Pour éviter de retélécharger le modèle à chaque démarrage, le bouton **Garder le modèle chez RunPod** (page Équipe et budget) crée un disque RunPod (« network volume ») de 150 Go, environ 10,50 $ par mois (Wan 2.2 en version allégée et Qwen-Image-Edit pour les photos), dans le centre qui a le plus de cartes de 80 Go libres, et le relie au serveur. Le serveur ne tourne ensuite que dans ce centre. Pour arrêter ce coût, supprimez le disque dans RunPod → **Storage**.

Le même serveur crée aussi les **photos de départ** des plans avec Qwen-Image-Edit (licence Apache 2.0, version rapide en 4 étapes, quelques centimes la photo). À l'étape Infos, ajoutez les **photos de référence** (une photo et un nom court par personnage, lieu ou objet), écrivez la description de la photo de chaque plan en citant ces noms, cochez les plans puis cliquez sur **🖼 Créer les photos** : toutes les photos partent d'un coup, avec les mêmes visages et décors. Envoyez de préférence les photos d'abord, puis les vidéos, pour que le serveur ne change pas de modèle à chaque fois.

## 7. Studio voix (RunPod)

Le studio voix a son propre petit serveur (dossier `worker-voix/`), sur une carte de 16 à 24 Go, bien moins chère que celle des vidéos : moins d'un centime par minute de voix, rien quand il ne tourne pas. Les modèles sont rangés dans l'image, donc rien à télécharger au démarrage.

| Modèle | Ce qu'il fait | Licence |
| --- | --- | --- |
| Meta MMS (`facebook/mms-tts-mlg`) | Texte → voix en **malgache** (une seule voix) | CC-BY-NC 4.0 : **pas d'usage commercial** |
| Kokoro 82M | Une cinquantaine de voix toutes prêtes : anglais US et UK, français, espagnol, chinois, italien, portugais, hindi | Apache 2.0 |
| Chatterbox multilingue | 23 langues, émotion réglable, voix d'une personne copiée à partir de 10 à 30 s d'enregistrement | MIT |
| Chatterbox VC | Change le timbre d'une voix (enregistrement, ou voix MMS en malgache) en gardant les mots | MIT |

1. Appliquez la migration `supabase/migrations/0014_voix.sql` (SQL Editor → coller → **Run**) : catalogue des voix, voix par défaut, voix créées dans les projets, et budget du mois qui compte aussi les voix.
2. Après la fusion dans `main`, GitHub construit l'image `ghcr.io/randnjara/studio-video-ia-voix` (`.github/workflows/serveur-voix.yml`, environ 20 minutes la première fois). Rendez ce paquet **public** comme celui du serveur vidéo : GitHub → profil → **Packages** → `studio-video-ia-voix` → **Package settings** → **Change visibility** → **Public**.
3. Page **Équipe et budget** → **Créer le serveur voix**. Son identifiant est gardé dans la table `reglages` (`runpod_endpoint_voix`). « Arrêter le serveur » l'arrête aussi.

Ensuite : menu **Voix** pour le catalogue et pour ajouter la voix d'une personne (avec son accord), et lien **🎙 Studio voix** en haut de chaque projet pour créer les voix, les régler dans la table de mixage (calculée par le navigateur, gratuite) et les envoyer au montage.

## Catégorie du film et plans continus (migration 0016)

Appliquez la migration `supabase/migrations/0016_categorie.sql` (SQL Editor → coller → **Run**). Elle ajoute la **catégorie** du film (interview, documentaire, film, promotion, tutoriel, clip) et le **plan continu** des lignes du tableau. Sans elle, le studio marche comme avant : la catégorie choisie n'est pas gardée et les lignes ne sont pas regroupées.

Ensuite, à l'étape 1 de chaque projet, choisissez la catégorie. La consigne ChatGPT suit ses règles : en interview, plusieurs lignes de 5 s forment un seul plan (même numéro dans la colonne `plan_continu`), avec une seule photo de départ pour tout le plan. Chaque clip suivant du plan part de la **dernière image du clip précédent** : il attend que ce clip soit fini, puis part tout seul. Cela marche avec notre serveur (moteurs « Économique ») à partir de l'image `v4` du serveur vidéo, construite par GitHub après la fusion (environ 20 minutes) ; le studio y bascule le serveur au prochain envoi. Avec « Qualité max », chaque clip repart de la photo du plan.

## Vérifications

- [ ] Je me connecte et je vois « Responsable » en haut à droite.
- [ ] Je crée un projet dans « Mon espace » et un autre dans « Équipe ».
- [ ] J'invite un membre. Il voit le projet d'équipe, mais pas mon projet personnel.
- [ ] Je fixe un budget du mois sur la page Équipe et budget.
- [ ] Dans un projet, onglet « Plans » : j'ajoute un plan avec une photo et un mouvement, je le coche et clique « Envoyer la sélection ». Dans « Clips », la vidéo apparaît en 1 à 4 minutes.

## Limites à connaître

- Le service d'e-mail gratuit de Supabase n'envoie que quelques e-mails par heure, en anglais, et ses modèles ne sont pas modifiables. C'est suffisant pour 4 personnes.
- Avec ces e-mails par défaut, un lien de connexion doit être ouvert dans le même navigateur que celui où il a été demandé. Les liens d'invitation, eux, marchent partout.
- Plus tard, on pourra brancher un service d'e-mail gratuit (par exemple Resend) : e-mails en français, sans limite gênante, et liens valables sur n'importe quel appareil (modèles pointant vers `/auth/confirm`).
- Un projet Supabase gratuit se met en pause après 7 jours sans aucune connexion. Il se réactive depuis le tableau de bord Supabase.
