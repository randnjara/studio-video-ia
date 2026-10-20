# Studio Vidéo IA

Application web privée pour une équipe de 1 à 4 personnes : transformer un scénario et des photos en vidéos de 1 min 30 à 2 min, générées par IA sur des GPU loués à l'usage.

Le cahier des charges complet et le guide pas à pas sont dans le document du projet sur Claude.

## Ce qui fonctionne déjà (étape 2)

- Connexion par lien envoyé par e-mail, sans mot de passe, **sur invitation uniquement**.
- Le premier compte devient responsable. Les suivants sont membres.
- Chaque membre a son espace personnel. Tout le monde partage l'espace « Équipe ».
- Créer un projet, le modifier, le déplacer d'un espace à l'autre, le mettre à la corbeille.
- Scénario avec historique : chaque modification garde une version, restaurable en un clic.
- Page « Équipe et budget » (responsable) : inviter, désactiver un membre (4 personnes maximum), fixer le budget GPU du mois, voir l'activité récente.
- Base de données protégée : chacun ne voit que ses espaces, et la génération se bloque quand le budget du mois est atteint.

## Outils

| Rôle | Outil |
| --- | --- |
| Site | Next.js 15 + Tailwind CSS, hébergé sur Cloudflare Workers (OpenNext) |
| Comptes et base | Supabase |
| Stockage des photos et vidéos | Supabase Storage (puis Cloudflare R2 pour les gros volumes) |
| Génération vidéo | Wan 2.2 image → vidéo, via RunPod (Public Endpoint) |

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
