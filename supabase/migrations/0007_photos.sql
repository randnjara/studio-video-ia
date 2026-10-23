-- Photos de départ créées par Qwen-Image-Edit à partir des références du film (personnages, lieux, objets, style)

-- Style commun ajouté à chaque photo du projet (époque, lumière, couleurs, type de caméra)
alter table public.projects add column style_text text not null default '';

create table public.film_refs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  nom text not null, -- cité tel quel dans la description d'un plan pour être utilisé
  genre text not null default 'personnage' check (genre in ('personnage', 'lieu', 'objet', 'style')),
  description text not null default '',
  image_path text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index on public.film_refs (project_id);

alter table public.film_refs enable row level security;
create policy film_refs_all on public.film_refs for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));

-- Une demande de photo de départ pour un plan ; la photo réussie remplace celle du plan
create table public.photos (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  status text not null default 'en_cours' check (status in ('en_cours', 'terminee', 'echouee')),
  image_path text,
  runpod_job_id text,
  ref_ids uuid[] not null default '{}',
  seed bigint,
  gpu_seconds numeric(10, 2),
  cost_usd numeric(10, 4),
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index on public.photos (scene_id);
create index on public.photos (created_at);

alter table public.photos enable row level security;
create policy photos_all on public.photos for all
  using (public.can_access_scene(scene_id)) with check (public.can_access_scene(scene_id));

create trigger photos_budget_check
  before insert on public.photos
  for each row execute function public.enforce_monthly_budget();

-- Le budget du mois compte aussi les photos
create or replace function public.month_spend_usd() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(coalesce(cost_usd, 0)) from takes where created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(coalesce(cost_usd, 0)) from photos where created_at >= date_trunc('month', now())), 0);
$$;
