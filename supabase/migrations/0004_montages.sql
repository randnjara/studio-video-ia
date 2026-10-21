-- Montages : une suite de clips validés, dans l'ordre choisi, à faire valider ou à corriger
create type montage_status as enum ('brouillon', 'a_valider', 'valide', 'a_corriger');

create table public.montages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null default 'Montage',
  take_ids uuid[] not null default '{}', -- clips dans l'ordre de lecture
  status montage_status not null default 'brouillon',
  comment text, -- remarques en cas de correction demandée
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.montages (project_id);

create trigger montages_touch before update on public.montages
  for each row execute function public.touch_updated_at();

alter table public.montages enable row level security;
create policy montages_all on public.montages for all
  using (public.can_access_project(project_id)) with check (public.can_access_project(project_id));
