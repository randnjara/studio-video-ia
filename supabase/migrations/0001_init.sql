-- Studio Vidéo IA : schéma initial de la base (Supabase / Postgres)
-- Couvre : comptes, espaces, projets, scènes, essais GPU, voix, timeline,
-- validations, exports, budget mensuel, journal d'activité, prompts types.

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type user_role as enum ('responsable', 'membre');
create type workspace_kind as enum ('personnel', 'equipe');
create type aspect_ratio as enum ('16:9', '9:16', '1:1');
create type project_status as enum ('scenario', 'production', 'montage', 'a_valider', 'valide', 'livre', 'archive');
create type scene_status as enum ('brouillon', 'en_generation', 'a_valider', 'validee', 'refusee');
create type take_status as enum ('en_attente', 'en_cours', 'terminee', 'echouee', 'annulee');
create type voice_source as enum ('ia', 'enregistree', 'importee');
create type review_decision as enum ('valide', 'a_corriger');
create type export_method as enum ('navigateur', 'serveur');
create type export_status as enum ('en_cours', 'pret', 'echoue');

-- ---------------------------------------------------------------------------
-- Comptes et espaces
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role user_role not null default 'membre',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind workspace_kind not null,
  owner_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Un seul espace d'équipe
create unique index one_team_workspace on workspaces (kind) where kind = 'equipe';

create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Projets, versions, scènes
-- ---------------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete restrict,
  title text not null,
  client_name text,
  aspect_ratio aspect_ratio not null default '9:16',
  voice_language text not null default 'fr',
  due_date date,
  status project_status not null default 'scenario',
  scenario_text text not null default '',
  scenario_validated_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz -- corbeille : effacé définitivement après 30 jours
);

-- Historique : chaque sauvegarde du scénario ou du montage garde une copie
create table project_versions (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects (id) on delete cascade,
  kind text not null check (kind in ('scenario', 'montage')),
  data jsonb not null,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table scenes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  position int not null,
  voiceover_text text not null default '',
  image_description text not null default '',
  motion_prompt text not null default '',
  duration_s numeric(5, 2) not null default 5,
  image_path text, -- clé R2 de la photo
  consent_confirmed boolean not null default false,
  status scene_status not null default 'brouillon',
  validated_take_id uuid,
  updated_at timestamptz not null default now(),
  unique (project_id, position) deferrable initially deferred
);

-- Un essai = une génération GPU d'un plan
create table takes (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes (id) on delete cascade,
  status take_status not null default 'en_attente',
  resolution text not null default '480p',
  seed bigint,
  video_path text,
  runpod_job_id text,
  gpu_seconds numeric(10, 2),
  cost_usd numeric(10, 4),
  error text,
  rejected_reason text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table scenes
  add constraint scenes_validated_take_fk
  foreign key (validated_take_id) references takes (id) on delete set null;

create table voice_clips (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references scenes (id) on delete cascade,
  source voice_source not null,
  audio_path text not null,
  duration_s numeric(6, 2),
  created_at timestamptz not null default now()
);

-- La timeline d'un projet (pistes vidéo, voix, musique, sous-titres) en JSON
create table timelines (
  project_id uuid primary key references projects (id) on delete cascade,
  data jsonb not null default '{"tracks": []}',
  version int not null default 1,
  updated_by uuid references profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  scene_id uuid references scenes (id) on delete set null,
  at_time_s numeric(7, 2), -- instant précis commenté dans la vidéo
  decision review_decision not null,
  comment text,
  reviewer_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  method export_method not null,
  status export_status not null default 'en_cours',
  video_path text,
  share_expires_at timestamptz, -- lien de téléchargement envoyé au client
  delivered_at timestamptz,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Budget, prompts types, journal
-- ---------------------------------------------------------------------------
create table monthly_budgets (
  month date primary key check (extract(day from month) = 1),
  limit_usd numeric(10, 2) not null
);

create table prompt_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  motion_prompt text not null,
  example_video_path text,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table activity_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index on projects (workspace_id) where deleted_at is null;
create index on scenes (project_id, position);
create index on takes (scene_id);
create index on takes (status) where status in ('en_attente', 'en_cours');
create index on takes (created_at);
create index on activity_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Fonctions d'aide
-- ---------------------------------------------------------------------------
create function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

create function is_responsable() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and role = 'responsable');
$$;

create function is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user() and exists (
    select 1 from workspace_members where workspace_id = ws and user_id = auth.uid()
  );
$$;

create function can_access_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from projects where id = p and is_workspace_member(workspace_id));
$$;

create function can_access_scene(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from scenes where id = s and can_access_project(project_id));
$$;

-- Dépense GPU du mois en cours (essais terminés + estimation des essais en file)
create function month_spend_usd() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(cost_usd, 0)), 0)
  from takes
  where created_at >= date_trunc('month', now());
$$;

-- ---------------------------------------------------------------------------
-- Déclencheurs
-- ---------------------------------------------------------------------------

-- Nouveau compte (créé par invitation) : profil, espace personnel, accès à l'espace d'équipe.
-- Le tout premier compte devient responsable.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  personal_ws uuid;
  team_ws uuid;
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;

  insert into profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    case when first_user then 'responsable'::user_role else 'membre'::user_role end
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Refuse un nouvel essai si le budget du mois est atteint
create function enforce_monthly_budget() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  budget numeric;
begin
  select limit_usd into budget from monthly_budgets
  where month = date_trunc('month', now())::date;
  if budget is not null and month_spend_usd() >= budget then
    raise exception 'Budget GPU du mois atteint (% $). Demandez au responsable de l''augmenter.', budget
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger takes_budget_check
  before insert on takes
  for each row execute function enforce_monthly_budget();

-- Mise à jour automatique de updated_at
create function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on projects
  for each row execute function touch_updated_at();
create trigger scenes_touch before update on scenes
  for each row execute function touch_updated_at();
create trigger timelines_touch before update on timelines
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Sécurité par ligne : chacun ne voit que ses espaces
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table project_versions enable row level security;
alter table scenes enable row level security;
alter table takes enable row level security;
alter table voice_clips enable row level security;
alter table timelines enable row level security;
alter table reviews enable row level security;
alter table exports enable row level security;
alter table monthly_budgets enable row level security;
alter table prompt_presets enable row level security;
alter table activity_log enable row level security;

-- Profils : tous les membres actifs se voient ; seul le responsable change rôles et accès
create policy profiles_read on profiles for select using (is_active_user());
create policy profiles_update_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on profiles for update using (is_responsable());

-- Un membre peut changer son nom, mais pas son rôle ni son accès
create function guard_profile_changes() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and auth.uid() is not null and not is_responsable() then
    raise exception 'Seul le responsable peut changer un rôle ou un accès.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_changes();

create policy workspaces_read on workspaces for select using (is_workspace_member(id));
create policy members_read on workspace_members for select using (is_workspace_member(workspace_id));

create policy projects_all on projects for all
  using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy versions_all on project_versions for all
  using (can_access_project(project_id)) with check (can_access_project(project_id));
create policy scenes_all on scenes for all
  using (can_access_project(project_id)) with check (can_access_project(project_id));
create policy takes_all on takes for all
  using (can_access_scene(scene_id)) with check (can_access_scene(scene_id));
create policy voices_all on voice_clips for all
  using (can_access_scene(scene_id)) with check (can_access_scene(scene_id));
create policy timelines_all on timelines for all
  using (can_access_project(project_id)) with check (can_access_project(project_id));
create policy exports_all on exports for all
  using (can_access_project(project_id)) with check (can_access_project(project_id));

-- Validation finale : lecture par l'équipe, décision par le responsable seulement
create policy reviews_read on reviews for select using (can_access_project(project_id));
create policy reviews_write on reviews for insert
  with check (is_responsable() and can_access_project(project_id) and reviewer_id = auth.uid());

create policy budgets_read on monthly_budgets for select using (is_active_user());
create policy budgets_write on monthly_budgets for all using (is_responsable()) with check (is_responsable());

create policy presets_read on prompt_presets for select using (is_active_user());
create policy presets_write on prompt_presets for all using (is_active_user()) with check (is_active_user());

create policy log_read on activity_log for select using (is_responsable());
create policy log_insert on activity_log for insert with check (is_active_user() and actor_id = auth.uid());

-- Suivi en direct de l'avancement des essais et des scènes
alter publication supabase_realtime add table takes, scenes;

-- ---------------------------------------------------------------------------
-- Prompts types de départ
-- ---------------------------------------------------------------------------
insert into prompt_presets (name, motion_prompt) values
  ('Produit qui tourne', 'The product slowly rotates 360 degrees on a clean surface, soft studio lighting, smooth motion, static camera'),
  ('Zoom lent', 'Slow cinematic push-in toward the subject, subtle natural movement, stable camera'),
  ('Personne qui sourit', 'The person looks at the camera and smiles naturally, slight head movement, blinking, shallow depth of field'),
  ('Travelling latéral', 'Smooth lateral tracking shot from left to right, parallax on background, natural lighting'),
  ('Photo ancienne animée', 'Gentle natural movement, the people breathe and blink softly, light camera drift, preserve faces');
