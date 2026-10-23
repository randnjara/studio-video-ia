-- Studio voix : catalogue des voix (partagé par l'équipe) et voix créées pour un projet.
-- Les voix sont calculées par un serveur RunPod à part (dossier worker-voix/), sur une petite carte graphique.

create table public.voix (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  langue text not null, -- mg, fr, en-US, en-GB, es, zh…
  genre text not null default 'autre' check (genre in ('femme', 'homme', 'autre')),
  age text not null default 'adulte' check (age in ('enfant', 'adulte', 'age')),
  -- mms : texte → voix de Meta (malgache) ; kokoro : voix toutes prêtes ;
  -- chatterbox : voix d'origine du modèle multilingue ; personne : copie la voix d'un enregistrement
  moteur text not null check (moteur in ('mms', 'kokoro', 'chatterbox', 'personne')),
  modele text not null default '', -- MMS : code langue (mlg) ; Kokoro : nom de la voix (ff_siwis) ; Chatterbox : code langue
  reference_path text, -- voix d'une personne : son enregistrement (dans le stockage « medias », dossier voix/)
  reglages jsonb not null default '{}', -- préréglage de la table de mixage (hauteur, vitesse, effets…)
  description text not null default '',
  usage_commercial boolean not null default true,
  par_defaut boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.voix (langue);

alter table public.voix enable row level security;
create policy voix_read on public.voix for select using (public.is_active_user());
create policy voix_insert on public.voix for insert
  with check (public.is_active_user() and created_by = auth.uid() and not par_defaut);
create policy voix_update on public.voix for update
  using (public.is_responsable() or (created_by = auth.uid() and not par_defaut))
  with check (public.is_responsable() or (created_by = auth.uid() and not par_defaut));
create policy voix_delete on public.voix for delete
  using (public.is_responsable() or (created_by = auth.uid() and not par_defaut));

-- Enregistrements des voix de personnes : dossier voix/ du stockage, lisible par toute l'équipe
create policy medias_voix_read on storage.objects for select to authenticated
  using (bucket_id = 'medias' and split_part(name, '/', 1) = 'voix' and public.is_active_user());
create policy medias_voix_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'medias' and split_part(name, '/', 1) = 'voix' and public.is_active_user());
create policy medias_voix_delete on storage.objects for delete to authenticated
  using (bucket_id = 'medias' and split_part(name, '/', 1) = 'voix' and (owner_id = auth.uid()::text or public.is_responsable()));

-- Une voix créée pour un projet : texte → voix, ou un enregistrement transformé avec une autre voix
create table public.voix_creations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  voix_id uuid references public.voix (id) on delete set null,
  nom text not null default '',
  texte text not null default '', -- vide pour un enregistrement transformé
  source_path text, -- enregistrement à transformer
  status text not null default 'en_cours' check (status in ('en_cours', 'terminee', 'echouee')),
  audio_path text, -- voix calculée par le serveur
  mixage_path text, -- version passée par la table de mixage, proposée au montage
  reglages jsonb not null default '{}',
  emotion numeric(4, 2) not null default 0.5,
  duree_s numeric(10, 2),
  runpod_job_id text,
  seed bigint,
  gpu_seconds numeric(10, 2),
  cost_usd numeric(10, 4),
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index on public.voix_creations (project_id, created_at desc);
create index on public.voix_creations (created_at);

alter table public.voix_creations enable row level security;
create policy voix_creations_all on public.voix_creations for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

-- Seules les voix calculées par le serveur comptent : un enregistrement simplement importé reste possible
create trigger voix_creations_budget_check
  before insert on public.voix_creations
  for each row when (new.status = 'en_cours') execute function public.enforce_monthly_budget();

-- Le budget du mois compte aussi les voix
create or replace function public.month_spend_usd() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(coalesce(cost_usd, 0)) from takes where created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(coalesce(cost_usd, 0)) from photos where created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(coalesce(cost_usd, 0)) from voix_creations where created_at >= date_trunc('month', now())), 0);
$$;

-- ---------------------------------------------------------------------------
-- Voix par défaut
-- ---------------------------------------------------------------------------

-- Malgache : une seule voix libre existe (Meta MMS, usage non commercial). Les autres sont des préréglages
-- de la table de mixage sur cette voix, marqués « effet ».
insert into public.voix (nom, langue, genre, age, moteur, modele, reglages, description, usage_commercial, par_defaut) values
  ('Malgache · voix de base', 'mg', 'autre', 'adulte', 'mms', 'mlg', '{}',
   'La seule voix libre qui parle vraiment malgache (Meta MMS).', false, true),
  ('Malgache · conteur (effet)', 'mg', 'autre', 'adulte', 'mms', 'mlg',
   '{"vitesse": 0.9, "grave": 3, "reverb": 0.15}', 'Voix de base, plus lente et plus chaude.', false, true),
  ('Malgache · femme (effet)', 'mg', 'femme', 'adulte', 'mms', 'mlg',
   '{"hauteur": 3, "aigu": 2}', 'Voix de base rendue plus aiguë.', false, true),
  ('Malgache · homme grave (effet)', 'mg', 'homme', 'adulte', 'mms', 'mlg',
   '{"hauteur": -4, "grave": 3}', 'Voix de base rendue plus grave.', false, true),
  ('Malgache · grand-mère (effet)', 'mg', 'femme', 'age', 'mms', 'mlg',
   '{"hauteur": 2, "vitesse": 0.85, "chevrotement": 0.45, "aigu": -3, "reverb": 0.1}',
   'Voix de base, lente et chevrotante. Pour une vraie grand-mère, ajoutez la voix d''une personne.', false, true),
  ('Malgache · grand-père (effet)', 'mg', 'homme', 'age', 'mms', 'mlg',
   '{"hauteur": -3, "vitesse": 0.85, "chevrotement": 0.35, "aigu": -3}', 'Voix de base, grave, lente et chevrotante.', false, true),
  ('Malgache · enfant (effet)', 'mg', 'autre', 'enfant', 'mms', 'mlg',
   '{"hauteur": 6, "vitesse": 1.08, "aigu": 2}', 'Voix de base rendue très aiguë et un peu plus rapide.', false, true);

-- Kokoro (licence Apache 2.0, usage commercial autorisé) : voix toutes prêtes
insert into public.voix (nom, langue, genre, age, moteur, modele, description, par_defaut)
select v.nom, v.langue, v.genre, 'adulte', 'kokoro', v.modele, 'Voix Kokoro', true
from (values
  ('Français · Siwis', 'fr', 'femme', 'ff_siwis'),
  ('Anglais US · Heart', 'en-US', 'femme', 'af_heart'),
  ('Anglais US · Bella', 'en-US', 'femme', 'af_bella'),
  ('Anglais US · Nicole', 'en-US', 'femme', 'af_nicole'),
  ('Anglais US · Sarah', 'en-US', 'femme', 'af_sarah'),
  ('Anglais US · Nova', 'en-US', 'femme', 'af_nova'),
  ('Anglais US · Sky', 'en-US', 'femme', 'af_sky'),
  ('Anglais US · Aoede', 'en-US', 'femme', 'af_aoede'),
  ('Anglais US · Kore', 'en-US', 'femme', 'af_kore'),
  ('Anglais US · Jessica', 'en-US', 'femme', 'af_jessica'),
  ('Anglais US · River', 'en-US', 'femme', 'af_river'),
  ('Anglais US · Alloy', 'en-US', 'femme', 'af_alloy'),
  ('Anglais US · Michael', 'en-US', 'homme', 'am_michael'),
  ('Anglais US · Adam', 'en-US', 'homme', 'am_adam'),
  ('Anglais US · Eric', 'en-US', 'homme', 'am_eric'),
  ('Anglais US · Liam', 'en-US', 'homme', 'am_liam'),
  ('Anglais US · Onyx', 'en-US', 'homme', 'am_onyx'),
  ('Anglais US · Fenrir', 'en-US', 'homme', 'am_fenrir'),
  ('Anglais US · Puck', 'en-US', 'homme', 'am_puck'),
  ('Anglais US · Echo', 'en-US', 'homme', 'am_echo'),
  ('Anglais US · Santa', 'en-US', 'homme', 'am_santa'),
  ('Anglais UK · Emma', 'en-GB', 'femme', 'bf_emma'),
  ('Anglais UK · Isabella', 'en-GB', 'femme', 'bf_isabella'),
  ('Anglais UK · Alice', 'en-GB', 'femme', 'bf_alice'),
  ('Anglais UK · Lily', 'en-GB', 'femme', 'bf_lily'),
  ('Anglais UK · George', 'en-GB', 'homme', 'bm_george'),
  ('Anglais UK · Fable', 'en-GB', 'homme', 'bm_fable'),
  ('Anglais UK · Daniel', 'en-GB', 'homme', 'bm_daniel'),
  ('Anglais UK · Lewis', 'en-GB', 'homme', 'bm_lewis'),
  ('Espagnol · Dora', 'es', 'femme', 'ef_dora'),
  ('Espagnol · Alex', 'es', 'homme', 'em_alex'),
  ('Espagnol · Santa', 'es', 'homme', 'em_santa'),
  ('Chinois · Xiaobei', 'zh', 'femme', 'zf_xiaobei'),
  ('Chinois · Xiaoni', 'zh', 'femme', 'zf_xiaoni'),
  ('Chinois · Xiaoxiao', 'zh', 'femme', 'zf_xiaoxiao'),
  ('Chinois · Xiaoyi', 'zh', 'femme', 'zf_xiaoyi'),
  ('Chinois · Yunjian', 'zh', 'homme', 'zm_yunjian'),
  ('Chinois · Yunxi', 'zh', 'homme', 'zm_yunxi'),
  ('Chinois · Yunxia', 'zh', 'homme', 'zm_yunxia'),
  ('Chinois · Yunyang', 'zh', 'homme', 'zm_yunyang'),
  ('Italien · Sara', 'it', 'femme', 'if_sara'),
  ('Italien · Nicola', 'it', 'homme', 'im_nicola'),
  ('Portugais (Brésil) · Dora', 'pt-BR', 'femme', 'pf_dora'),
  ('Portugais (Brésil) · Alex', 'pt-BR', 'homme', 'pm_alex'),
  ('Hindi · Alpha', 'hi', 'femme', 'hf_alpha'),
  ('Hindi · Beta', 'hi', 'femme', 'hf_beta'),
  ('Hindi · Omega', 'hi', 'homme', 'hm_omega'),
  ('Hindi · Psi', 'hi', 'homme', 'hm_psi')
) as v (nom, langue, genre, modele);

-- Préréglages âge sur des voix Kokoro (effet de la table de mixage)
insert into public.voix (nom, langue, genre, age, moteur, modele, reglages, description, par_defaut) values
  ('Français · grand-mère (effet)', 'fr', 'femme', 'age', 'kokoro', 'ff_siwis',
   '{"hauteur": -1, "vitesse": 0.85, "chevrotement": 0.45, "aigu": -3, "reverb": 0.1}', 'Siwis, lente et chevrotante.', true),
  ('Français · fillette (effet)', 'fr', 'femme', 'enfant', 'kokoro', 'ff_siwis',
   '{"hauteur": 4, "vitesse": 1.05, "aigu": 2}', 'Siwis rendue plus aiguë.', true),
  ('Anglais US · grand-père (effet)', 'en-US', 'homme', 'age', 'kokoro', 'am_michael',
   '{"hauteur": -2, "vitesse": 0.85, "chevrotement": 0.35, "aigu": -3}', 'Michael, lent et chevrotant.', true),
  ('Anglais US · enfant (effet)', 'en-US', 'autre', 'enfant', 'kokoro', 'af_sky',
   '{"hauteur": 4, "vitesse": 1.05, "aigu": 2}', 'Sky rendue plus aiguë.', true);

-- Chatterbox multilingue (licence MIT) : la voix d'origine du modèle, avec réglage de l'émotion
insert into public.voix (nom, langue, genre, age, moteur, modele, description, par_defaut)
select v.nom, v.code, 'autre', 'adulte', 'chatterbox', v.code, 'Voix d''origine de Chatterbox, émotion réglable', true
from (values
  ('Français · Chatterbox', 'fr'),
  ('Anglais · Chatterbox', 'en'),
  ('Espagnol · Chatterbox', 'es'),
  ('Chinois · Chatterbox', 'zh'),
  ('Allemand · Chatterbox', 'de'),
  ('Italien · Chatterbox', 'it'),
  ('Portugais · Chatterbox', 'pt'),
  ('Arabe · Chatterbox', 'ar'),
  ('Swahili · Chatterbox', 'sw'),
  ('Malais · Chatterbox', 'ms'),
  ('Japonais · Chatterbox', 'ja'),
  ('Coréen · Chatterbox', 'ko'),
  ('Russe · Chatterbox', 'ru'),
  ('Néerlandais · Chatterbox', 'nl'),
  ('Turc · Chatterbox', 'tr'),
  ('Hindi · Chatterbox', 'hi')
) as v (nom, code);
