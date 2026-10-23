# Studio Vidéo IA

Application web privée pour une équipe (taille libre) : transformer un script et des photos en vidéos de la durée voulue, générées par IA sur des GPU loués à l'usage.

Le cahier des charges complet et le guide pas à pas sont dans le document du projet sur Claude.

## Ce qui fonctionne déjà

- Connexion par lien envoyé par e-mail, sans mot de passe, **sur invitation uniquement**. Rôles responsable / membre modifiables.
- Chaque membre a son espace personnel. Tout le monde partage l'espace « Équipe ».
- Chaque projet suit 5 étapes, en onglets (l'étape actuelle est en couleur) :
  1. **Infos** : titre, format, résumé, voix off, style, photos de référence (au minimum le personnage principal), puis « Valider les informations ». Aussi : prochaine étape, historique, corbeille.
  2. **ChatGPT** : télécharger le fichier vide et copier la consigne ; ChatGPT découpe la voix off en plans et remplit le fichier (prompts photo et vidéo compris) ; importer le fichier rempli.
  3. **Plans** : vérifier les alertes, photos de départ de 2 façons (créées par notre serveur RunPod, ou faites ailleurs avec les prompts copiés puis importées d'un coup, plan_01.png, plan_02.png…), cocher les plans à envoyer à la génération. Ajout à la main toujours possible (un plan, ou script + photos d'un coup).
  4. **Clips** : suivre les générations (notification quand c'est prêt), valider un clip, le refuser (le plan repart en modification) ou regénérer.
  5. **Montage** : assembler les clips validés dans l'ordre voulu, aperçu enchaîné, envoyer à valider, valider ou renvoyer en correction avec un commentaire.
- Page « Équipe et budget » (responsable) : inviter, changer le rôle, désactiver un membre, fixer le budget GPU du mois, voir l'activité récente.
- Base de données protégée : chacun ne voit que ses espaces, et la génération se bloque quand le budget du mois est atteint.

## Outils

| Rôle | Outil |
| --- | --- |
| Site | Next.js 16 + Tailwind CSS, hébergé sur Cloudflare Workers (OpenNext) |
| Comptes et base | Supabase |
| Stockage des photos et vidéos | Supabase Storage (puis Cloudflare R2 pour les gros volumes) |
| Photos de départ | Qwen-Image-Edit sur notre serveur RunPod, à partir des références du film |
| Génération vidéo | Wan 2.2 image → vidéo : notre serveur RunPod (dossier `worker/`, version rapide 4 étapes) ou le service tout prêt RunPod (qualité max) |

## Mise en route

Suivez [docs/INSTALLATION.md](docs/INSTALLATION.md). Comptez environ 30 minutes.

## Pour les développeurs

```bash
cp .env.example .env.local   # puis remplir les valeurs
npm install
npm run dev                  # http://localhost:3000
npm run typecheck
npm run build
```

La structure de la base est dans `supabase/migrations/`.
