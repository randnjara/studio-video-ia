-- Journal des connexions (liens demandés, réussites, erreurs), pour aider le responsable quand quelqu'un n'arrive
-- pas à se connecter. Écrit par le serveur avec la clé secrète, lisible par le responsable seulement.
create table public.journal_connexion (
  id bigint generated always as identity primary key,
  email text,
  evenement text not null,
  detail text not null default '',
  appareil text not null default '',
  created_at timestamptz not null default now()
);

create index journal_connexion_date on public.journal_connexion (created_at desc);
alter table public.journal_connexion enable row level security;
create policy journal_connexion_read on public.journal_connexion for select using (public.is_responsable());

-- Sessions ouvertes de chaque membre (appareils connectés)
create function public.sessions_membres()
returns table (user_id uuid, sessions bigint, derniere_activite timestamptz)
language sql stable security definer set search_path = ''
as $$
  select s.user_id, count(*), max(coalesce(s.refreshed_at, s.updated_at, s.created_at)::timestamptz)
  from auth.sessions s
  where public.is_responsable()
  group by s.user_id
$$;

-- Déconnecte un membre de tous ses appareils (rien n'est supprimé si l'appelant n'est pas responsable)
create function public.reinitialiser_sessions(uid uuid)
returns bigint
language sql security definer set search_path = ''
as 'with d as (delete from auth.sessions where user_id = uid and public.is_responsable() returning 1) select count(*) from d';

revoke execute on function public.sessions_membres() from public, anon;
revoke execute on function public.reinitialiser_sessions(uuid) from public, anon;
grant execute on function public.sessions_membres() to authenticated;
grant execute on function public.reinitialiser_sessions(uuid) to authenticated;
