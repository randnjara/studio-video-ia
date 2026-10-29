-- Connexion par nom d'utilisateur et mot de passe (les liens par e-mail butent sur la limite des e-mails gratuits).
-- Le mot de passe lui-même est gardé, haché, par Supabase Auth : rien ici.

alter table public.profiles
  add column username text,
  add column telephone text not null default '',
  -- Compte de secours : toujours actif et responsable, personne d'autre ne peut le modifier ni le supprimer
  add column super_admin boolean not null default false;

-- Noms d'utilisateur des comptes existants : la partie de l'e-mail avant le @ (suivie d'un numéro si déjà pris)
with base as (
  select p.id,
         coalesce(nullif(regexp_replace(lower(split_part(u.email, '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'membre') as nom,
         p.created_at
  from public.profiles p join auth.users u on u.id = p.id
), numerote as (
  select id, nom, row_number() over (partition by nom order by created_at) as n from base
)
update public.profiles p
set username = case when numerote.n = 1 then numerote.nom else numerote.nom || numerote.n end
from numerote where numerote.id = p.id;

alter table public.profiles
  alter column username set not null,
  add constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,30}$');
create unique index profiles_username_unique on public.profiles (username);

-- Nouveau compte : nom d'utilisateur choisi à la création, sinon tiré de l'e-mail
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  personal_ws uuid;
  team_ws uuid;
  first_user boolean;
  base_nom text;
  nom text;
  n int := 1;
begin
  select not exists (select 1 from profiles) into first_user;

  base_nom := coalesce(
    nullif(regexp_replace(lower(coalesce(new.raw_user_meta_data ->> 'username', '')), '[^a-z0-9._-]', '', 'g'), ''),
    nullif(regexp_replace(lower(split_part(coalesce(new.email, ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), ''),
    'membre'
  );
  base_nom := left(base_nom, 26);
  base_nom := base_nom || repeat('0', greatest(0, 3 - length(base_nom))); -- 3 caractères au moins
  nom := base_nom;
  while exists (select 1 from profiles where username = nom) loop
    n := n + 1;
    nom := base_nom || n;
  end loop;

  insert into profiles (id, display_name, role, username, telephone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    case when first_user then 'responsable'::user_role else 'membre'::user_role end,
    nom,
    coalesce(new.raw_user_meta_data ->> 'telephone', '')
  );

  insert into workspaces (name, kind, owner_id)
  values ('Mon espace', 'personnel', new.id)
  returning id into personal_ws;
  insert into workspace_members (workspace_id, user_id) values (personal_ws, new.id);

  select id into team_ws from workspaces where kind = 'equipe';
  if team_ws is null then
    insert into workspaces (name, kind, owner_id) values ('Équipe', 'equipe', new.id)
    returning id into team_ws;
  end if;
  insert into workspace_members (workspace_id, user_id) values (team_ws, new.id);

  return new;
end;
$$;

-- Un membre peut changer son nom, son nom d'utilisateur et son téléphone, pas son rôle ni son accès.
-- Le compte de secours ne se modifie que par lui-même (et jamais son rôle, son accès ou sa qualité de secours).
create or replace function public.guard_profile_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new; -- serveur avec la clé secrète, ou tableau de bord Supabase
  end if;
  if new.super_admin is distinct from old.super_admin then
    raise exception 'Le compte de secours ne peut pas être changé depuis le site.' using errcode = '42501';
  end if;
  if old.super_admin and (new.role is distinct from old.role or new.active is distinct from old.active
                          or old.id <> auth.uid()) then
    raise exception 'Le compte de secours ne peut pas être modifié.' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active) and not is_responsable() then
    raise exception 'Seul le responsable peut changer un rôle ou un accès.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.guard_profile_changes() from public, anon, authenticated;
