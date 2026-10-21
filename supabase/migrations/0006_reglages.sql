-- Réglages du studio (ex. identifiant de notre serveur RunPod), lisibles par l'équipe, modifiables par le responsable
create table public.reglages (
  cle text primary key,
  valeur text not null,
  updated_at timestamptz not null default now()
);

alter table public.reglages enable row level security;
create policy reglages_read on public.reglages for select using (public.is_active_user());
create policy reglages_write on public.reglages for all using (public.is_responsable()) with check (public.is_responsable());
