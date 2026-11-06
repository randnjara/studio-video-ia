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

## 8. Lip-sync sur la voix off (RunPod, migration 0018)

Comme « image → vidéo + voix » d'ElevenLabs : chaque plan reçoit sa photo de départ (ou la dernière image du clip précédent) et son morceau de voix off ; la bouche suit exactement la voix. La vidéo sort **muette** ; au montage, la voix off d'origine reste sur sa propre piste (volume, fondus, musique et ambiance réglables sans rien regénérer).

| Étape | Où | Outil |
| --- | --- | --- |
| Découpe de la voix off en un morceau par plan (WAV 16 kHz mono), recalage facultatif sur les silences (Whisper) | Serveur voix (`worker-voix/`, version 3) | ffmpeg, faster-whisper |
| Clip lip-sync, 25 images/s, autant d'images que la voix en demande, sans piste audio, + dernière image | Serveur lip-sync (`worker-lipsync/`) | InfiniteTalk (Apache 2.0) sur Wan 2.1 I2V 14B 480p, LoRA rapide lightx2v |
| Voix off entière à 0 s sur la piste « Voix off », clips calés à leur début dans la voix | Montage (navigateur) | Mediabunny |

1. La migration `supabase/migrations/0018_lipsync_voix_off.sql` est déjà appliquée sur Supabase (colonnes de `voice_clips` et `takes`, moteur `lipsync`, clé `runpod_endpoint_lipsync`).
2. Après la fusion dans `main`, GitHub construit deux images : `ghcr.io/randnjara/studio-video-ia-voix:v3` (le serveur voix apprend à découper) et `ghcr.io/randnjara/studio-video-ia-worker:lipsync` (`.github/workflows/serveur-lipsync.yml`, environ 30 minutes la première fois ; aussi `:lipsync-v1`). Le paquet `studio-video-ia-worker` doit rester **public** (il l’est déjà pour le serveur vidéo). Le studio passe tout seul le serveur voix sur la version 3 à la première découpe. Une voix off qui ne couvre que le début du film ne découpe que ses plans (les autres sont annoncés « sans voix ») ; « Recaler » est décoché par défaut et n’étire jamais la voix au-delà de 20 % d’écart.
3. Page **Équipe et budget** → **Serveur lip-sync** → **Créer le serveur lip-sync** (cartes de 80 Go, 0 machine au repos, 2 au maximum, 80 Go de disque). L'identifiant est rangé dans `reglages.runpod_endpoint_lipsync`. Vous pouvez aussi créer le serveur à la main dans RunPod → **Serverless** → **New Endpoint** → **Import from Docker Registry** → image `ghcr.io/randnjara/studio-video-ia-worker:lipsync-v1`, cartes 80 Go (A100 / H100), « Max workers » 2, « Idle timeout » 30 s, disque 80 Go, champ **Model** `Wan-AI/Wan2.1-I2V-14B-480P` ; puis collez son identifiant (ex. `abc123xyz`, visible dans l'adresse de la page du serveur) dans le champ à côté du bouton.
4. Dans la console RunPod, serveur `studio-lipsync` → **Manage** → **Edit Endpoint**, champ **Model** : `Wan-AI/Wan2.1-I2V-14B-480P`, puis **Save**. Sans cela, le premier clip télécharge Wan 2.1 (long et facturé). Les poids InfiniteTalk (`MeiGen-AI/InfiniteTalk`, fichier `single/infinitetalk.safetensors`) et le LoRA rapide sont téléchargés au premier démarrage de chaque machine.

La clé `RUNPOD_API_KEY` reste la seule clé : elle se range uniquement comme **secret** du Worker Cloudflare (partie 5), jamais dans le code ni dans la base.

Voix off déjà finie (ElevenLabs, micro…) : onglet **Plans** → bloc « 🎙 Voix off et lip-sync » → **⬆ Importer la voix off audio** (MP3, WAV, M4A, OGG, ou glisser-déposer). Le fichier va dans le stockage du projet (un WAV de plus de 50 Mo est d'abord réduit en WAV mono par le navigateur), sa durée est lue par le navigateur, et il devient une voix terminée du projet (`voix_creations`, `source = 'importee'`, sans calcul RunPod ni coût), choisie aussitôt pour « ✂ Découper la voix off » et posée sur la piste voix off au montage. Un avertissement s'affiche si sa durée s'écarte de plus de 10 % de celle des plans. Migration `supabase/migrations/0019_voix_importee.sql` (colonne `source`) : à appliquer dans Supabase ; sans elle, l'import fonctionne aussi, la voix est simplement enregistrée sans sa source.

Utilisation : studio voix → créer la voix off (ou l'importer, ci-dessus) ; onglet **ChatGPT** → le tableau rempli contient « debut » et « fin » (minutage dans la voix off) ; onglet **Plans** → importer le tableau : la découpe de la voix off part toute seule (ou bouton **✂ Découper la voix off**), puis **🗣 Générer toutes les scènes en lip-sync** (ou le moteur « Lip-sync (voix off) » dans la barre d'envoi, ou le bouton **🗣 Lip-sync** d'un plan dans « Clips »). Au montage, un nouveau montage pose la voix off entière à 0 s et lie chaque clip lip-sync (🔗) ; **Délier de la voix** remet un clip bout à bout, **Relier à la voix off** le recale ; **Remplacer par** change le fichier d'un son sans perdre sa place ni ses liens.

Réglages du serveur (variables d'environnement du serveur RunPod, facultatives) : `STEPS` (6), `AUDIO_GUIDE` (2 ; plus haut = bouche plus fidèle), `TEXT_GUIDE` (1), `SHIFT` (2), `LORA_REPO` vide pour la version normale en 40 étapes (meilleure, 5 à 6 fois plus lente).

Tests sans carte graphique : `npm run test:lipsync` (montage : décalage voix/bouche < 2 images, régler la voix ne touche pas la vidéo), `python3 worker-voix/test_decoupage.py` (morceaux exacts, recalage), `python3 worker-lipsync/test_video.py` (durée = voix ± 1 image, pas de piste audio).

## 9. Audio d'abord : la voix off audio fixe les plans

La voix off AUDIO est la seule source de minutage ; son texte n'est que ce qui a été lu.

**Nouveau projet (flux recommandé, onglet ChatGPT, encadré « À partir de la voix off audio — recommandé »)** :
1. Importer la voix off audio (⬆, ou glisser-déposer) ou la créer dans le studio voix.
2. « Préparer le tableau depuis l'audio » : le serveur voix (Whisper `medium`, mots horodatés) découpe la voix en répliques de 5 s au plus, aux pauses et aux fins de phrases, et mesure le ton de chacune (débit, pauses, volume, montée ou descente : calme, joyeux, ému, rieur, interrogatif). Ces répliques SONT la liste des plans. Rien n'est écrit par Whisper dans les prompts.
3. Télécharger le fichier pré-rempli (numéro, début, fin, durée, voix) et copier la consigne : ChatGPT ou Claude ne remplit que la mise en scène (intention, geste, cadrage, angle, lieu, raccord, poses, prompts), avec des repères « Xs-Ys » calculés sur la vraie durée, et toutes les règles (dont R1 à R7 ci-dessous). Avec le secret `ANTHROPIC_API_KEY` dans Cloudflare (Worker → Settings → Variables and Secrets → Secret), le bouton « ✨ Remplir le tableau automatiquement » le fait sans copier-coller (Claude Opus 5.5). La clé `OPENAI_API_KEY` n'est pas utilisée.
4. Importer le tableau : numéro, début, fin, durée et voix sont vérifiés et remis à leur valeur audio (une réplique manquante est refusée). Les plans naissent calés sur l'audio ; la découpe de la voix off part toute seule.

**Projet existant (tableau fait avant, durées estimées)** : dans l'onglet Plans, choisir ou importer la voix off cale automatiquement les plans dessus (« 🎧 Caler les plans sur la voix off » pour relancer) : chaque plan dure exactement sa réplique prononcée et la pause qui suit, la durée du film devient celle de l'audio, une réplique de plus de 5 s est scindée à la pause la plus proche (texte et prompt répartis, poses raccordées), et l'ancien tableau est gardé (« Scripts précédents » → « Revenir à ce tableau »). Les repères des prompt_video sont remis à l'échelle ; les plans dont la durée a changé de plus de 0,5 s sont marqués « ✏ prompt à refaire », et « 📋 Copier la consigne pour refaire le tableau » donne à l'assistant le texte prononcé, le minutage réel, les pauses et le ton de chaque plan. Le tableau rendu se réimporte comme « tableau corrigé » : les prompts sont remplacés, le minutage audio est gardé.

**Prévention des risques (par défaut)** : la consigne du tableau, la vérification et la liste « Plans à risque » (onglet Plans, score par plan, raison et correction proposée de prompt_video) appliquent R1 à R7 : jamais de recul ni de cadrage plus large en cours de film ; pas de rire franc ni de tête penchée (rotation ≤ 15°) ; émotion par les yeux, la respiration et les sourcils, jamais par la bouche ; mains calmes, jamais près du visage, pas de doigts détaillés ; pas d'objet tenu, de cheveux devant le visage, de lumière qui change, de changement de lieu ou de tenue ; arcs de caméra ≤ 15° ; en lip-sync, prompt_video n'évoque jamais la parole ni la bouche.

Le serveur voix passe en version 4 (Whisper `medium` rangé dans l'image) ; le studio le bascule tout seul. Aucune migration n'est nécessaire : transcriptions et anciens tableaux sont gardés dans `project_versions`.

## 10. Historique et suivi en direct des travaux serveur (migration 0020)

Chaque travail envoyé à un serveur RunPod (voix, transformation, découpe, calage et transcription Whisper, photos, vidéos, Visage fidèle, lip-sync) est noté dans `travaux_serveur`, avec ses étapes dans `travaux_evenements` : envoyé → file d'attente RunPod → serveur qui démarre → modèle en téléchargement → calcul (avec le % envoyé par le serveur : « 45 % de l'audio », « étape 3/4 », « images ~60/125 », « plan 12/48 ») → envoi du résultat → terminé, échoué (message lisible et détail technique) ou annulé. Les arrêts, redémarrages, créations de serveurs et changements d'image y sont aussi.

- Là où l'action est lancée, une frise en direct (✓ / ⏳ / ✗, heure, durée, %) remplace le texte d'attente et reste visible ensuite (« Voir le détail »). Sans nouvelle du serveur depuis 4 min, elle le dit et propose « Annuler » (et « Relancer » pour le calage et la découpe).
- Page « 🧾 Historique » (menu de gauche, et lien dans chaque projet) : filtres par projet, type, statut et date, avec la durée, le coût, qui l'a lancé et l'erreur.
- Appliquez `supabase/migrations/0020_travaux_serveur.sql` (SQL Editor → coller → **Run**). Sans elle, tout fonctionne comme avant, mais rien n'est noté et l'historique affiche un message.
- Les trois images des serveurs passent en nouvelle version (vidéo v8, voix v5, lip-sync v2) pour envoyer ces nouvelles ; le studio les bascule tout seul au prochain envoi.

## 11. Cartes Blackwell (RTX PRO 6000, MIG 1g.24gb, B200)

RunPod range les cartes Blackwell (sm_120) dans « Latest generation ». Elles exigent une image CUDA 12.8 ou plus : sur une image plus ancienne (voix v4/v5 : torch 2.6 CUDA 12.4), le premier calcul plante (« no kernel image is available for execution on the device ») et RunPod marque la machine « unhealthy ».

- Images CUDA 12.8 (Blackwell et cartes d'avant, sm_80 à sm_90) : vidéo/photo/VACE **v9** (torch 2.11), voix **v6** (torch 2.7.1 ; Chatterbox installé sans ses dépendances car il demande torch 2.6), lip-sync **v3** (torch 2.7.1, xformers 0.0.31.post1, flash-attn 2.8.0.post2 précompilé). La construction vérifie que torch contient sm_80, sm_90 et sm_120.
- Au démarrage, chaque serveur contrôle sa carte : si elle n'est pas gérée, chaque travail répond « Carte X non compatible avec l'image … » (visible dans l'historique) au lieu de planter. Whisper passe sur le processeur et le lip-sync sur l'attention de PyTorch si leur bibliothèque n'a pas de code pour la carte.
- Création des serveurs : liste explicite des cartes par image (`src/lib/cartes-gpu.ts`) et machines avec un pilote CUDA 12.8 au moins. Les machines « unhealthy » signalées par RunPod apparaissent dans l'historique.

**Remettre les cartes « Latest generation »**, une fois les nouvelles images construites (workflows « Serveur vidéo », « Serveur voix » et « Serveur lip-sync » verts après le merge) :
1. Lancer un travail de chaque sorte (une voix, un clip, un clip lip-sync) : le studio passe chaque serveur sur sa nouvelle image (voir « 🧾 Historique » → « Nouvelle image du serveur »). Ou, dans la console RunPod, serveur → **Manage** → **Edit Endpoint** → **Container Image** : `ghcr.io/randnjara/studio-video-ia-voix:v6`, `ghcr.io/randnjara/studio-video-ia-worker:lipsync-v3`, `ghcr.io/randnjara/studio-video-ia-worker:v9`.
2. Même écran : **GPU Configuration** → cocher de nouveau les cartes « Latest generation » voulues (RTX PRO 6000, MIG 24 Go…), et **Allowed CUDA versions** : 12.8 et plus. **Save**.
3. Vérifier : un travail sur une carte Blackwell se termine, sans « worker unhealthy » ni « non compatible avec l'image » dans l'historique.

## Catégorie du film et plans continus (migration 0016)

Appliquez la migration `supabase/migrations/0016_categorie.sql` (SQL Editor → coller → **Run**). Elle ajoute la **catégorie** du film (interview, documentaire, film, promotion, tutoriel, clip) et le **plan continu** des lignes du tableau. Sans elle, le studio marche comme avant : la catégorie choisie n'est pas gardée et les lignes ne sont pas regroupées.

Ensuite, à l'étape 1 de chaque projet, choisissez la catégorie. La consigne ChatGPT suit ses règles : en interview, plusieurs lignes de 5 s forment un seul plan (même numéro dans la colonne `plan_continu`), avec une seule photo de départ pour tout le plan. Chaque clip suivant du plan part de la **dernière image du clip précédent** : il attend que ce clip soit fini, puis part tout seul. Cela marche avec notre serveur (moteurs « Économique ») à partir de l'image `v4` du serveur vidéo, construite par GitHub après la fusion (environ 20 minutes) ; le studio y bascule le serveur au prochain envoi. Avec « Qualité max », chaque clip repart de la photo du plan.

**Prise unique, dans toutes les catégories.** Tout le film est une seule prise : une seule photo (celle du plan 1), et chaque clip part de la dernière image du clip précédent, du début à la fin, même quand le cadrage, le lieu ou le personnage change. Un zoom ou un changement de cadrage, de lieu ou de personnage est rare, vient du sens de la voix off, et se fait au milieu du clip, jamais à sa première ni à sa dernière seconde. Si la consigne vidéo d'un nouveau cadrage ne parle pas de mouvement, le studio ajoute lui-même un lent zoom au milieu du clip d'après la colonne « cadrage » ; un mouvement placé au début ou à la fin du clip est signalé dans les alertes. La catégorie règle seulement le rythme. Les clips partent donc un par un, dans l'ordre du film.

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
