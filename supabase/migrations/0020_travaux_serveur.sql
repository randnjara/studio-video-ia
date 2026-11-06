-- Historique et suivi détaillé de tout ce qui passe par un serveur (RunPod) : voix, transformation, découpe, calage et
-- transcription Whisper, photos, vidéos, VACE, lip-sync, et la vie des serveurs (arrêt, redémarrage, changement d'image).
-- Un travail = un calcul envoyé au serveur ; ses événements = les étapes vues en direct (file d'attente, démarrage du
-- serveur, téléchargement du modèle, calcul avec %, envoi du résultat, fin).

create table public.travaux_serveur (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade, -- vide pour la vie des serveurs (toute l'équipe)
  type text not null, -- voix, voix-transformation, decoupe, calage, transcription, photo, video, video-qualite, video-vace, lipsync, serveur-…
  serveur text, -- identifiant du serveur RunPod (endpoint)
  runpod_job_id text unique,
  statut text not null default 'envoye'
    check (statut in ('envoye', 'file', 'demarrage', 'telechargement', 'calcul', 'envoi', 'termine', 'echoue', 'annule')),
  etape text not null default 'envoye', -- dernière étape vue
  progression numeric(5, 1), -- 0 à 100
  message text not null default '',
  erreur text, -- message lisible
  erreur_detail text, -- détail technique
  cout_usd numeric(10, 4),
  secondes_gpu numeric(10, 2),
  details jsonb not null default '{}',
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  maj_at timestamptz not null default now(), -- dernière nouvelle du serveur (pour « pas de nouvelle depuis 4 min »)
  fini_at timestamptz
);

create index on public.travaux_serveur (project_id, created_at desc);
create index on public.travaux_serveur (created_at desc);
create index on public.travaux_serveur (statut) where statut not in ('termine', 'echoue', 'annule');

create table public.travaux_evenements (
  id bigint generated always as identity primary key,
  travail_id uuid not null references public.travaux_serveur (id) on delete cascade,
  created_at timestamptz not null default now(),
  etape text not null,
  message text not null default '',
  progression numeric(5, 1)
);

create index on public.travaux_evenements (travail_id, created_at);

-- Droits : un travail d'un projet suit les droits du projet ; la vie des serveurs (sans projet) est visible par l'équipe
create or replace function public.can_access_travail(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_project is null then public.is_active_user() else public.can_access_project(p_project) end;
$$;

alter table public.travaux_serveur enable row level security;
alter table public.travaux_evenements enable row level security;

create policy travaux_read on public.travaux_serveur for select using (public.can_access_travail(project_id));
create policy travaux_insert on public.travaux_serveur for insert with check (public.can_access_travail(project_id));
create policy travaux_update on public.travaux_serveur for update
  using (public.can_access_travail(project_id)) with check (public.can_access_travail(project_id));

create policy travaux_evenements_read on public.travaux_evenements for select
  using (exists (select 1 from public.travaux_serveur t where t.id = travail_id and public.can_access_travail(t.project_id)));
create policy travaux_evenements_insert on public.travaux_evenements for insert
  with check (exists (select 1 from public.travaux_serveur t where t.id = travail_id and public.can_access_travail(t.project_id)));

-- Ouvre un travail et son premier événement « envoyé » (un seul appel depuis le studio)
create or replace function public.ouvrir_travail(
  p_project uuid, p_type text, p_serveur text, p_job text, p_message text default '', p_details jsonb default '{}'
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare v_id uuid;
begin
  insert into travaux_serveur (project_id, type, serveur, runpod_job_id, message, details)
  values (p_project, p_type, p_serveur, p_job, p_message, coalesce(p_details, '{}'))
  on conflict (runpod_job_id) do update set maj_at = now()
  returning id into v_id;
  insert into travaux_evenements (travail_id, etape, message) values (v_id, 'envoye', p_message);
  return v_id;
end;
$$;

-- Note une nouvelle du serveur pour un travail (un seul appel par suivi) : l'événement n'est ajouté que si l'étape, le
-- message ou la progression changent ; un travail fini ne change plus.
create or replace function public.noter_travail(
  p_job text, p_etape text, p_message text default '', p_progression numeric default null,
  p_erreur text default null, p_erreur_detail text default null, p_cout numeric default null, p_secondes numeric default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare t travaux_serveur%rowtype; v_fini boolean := p_etape in ('termine', 'echoue', 'annule');
begin
  select * into t from travaux_serveur where runpod_job_id = p_job;
  if not found or t.statut in ('termine', 'echoue', 'annule') then return; end if;
  if t.etape is distinct from p_etape or t.message is distinct from coalesce(p_message, '')
     or t.progression is distinct from p_progression then
    insert into travaux_evenements (travail_id, etape, message, progression)
    values (t.id, p_etape, coalesce(p_message, ''), p_progression);
    update travaux_serveur set
      statut = p_etape, etape = p_etape, message = coalesce(p_message, ''), progression = p_progression, maj_at = now(),
      erreur = coalesce(p_erreur, erreur), erreur_detail = coalesce(p_erreur_detail, erreur_detail),
      cout_usd = coalesce(p_cout, cout_usd), secondes_gpu = coalesce(p_secondes, secondes_gpu),
      fini_at = case when v_fini then now() else null end
    where id = t.id;
  end if;
end;
$$;

grant execute on function public.ouvrir_travail(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.noter_travail(text, text, text, numeric, text, text, numeric, numeric) to authenticated;
grant execute on function public.can_access_travail(uuid) to authenticated;
