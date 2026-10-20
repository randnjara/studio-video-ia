-- Étape 3 : stockage des photos et des vidéos générées.
-- Un seul dossier privé « medias », rangé par projet : <projet>/photos/... et <projet>/essais/...
-- Seuls les membres qui ont accès au projet peuvent lire ou déposer ses fichiers.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medias',
  'medias',
  false,
  52428800, -- 50 Mo par fichier
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
)
on conflict (id) do nothing;

-- Le premier dossier du chemin est l'identifiant du projet
create function public.media_project_id(object_name text) returns uuid
language sql immutable set search_path = public as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

revoke execute on function public.media_project_id(text) from public, anon;
grant execute on function public.media_project_id(text) to authenticated;

create policy medias_read on storage.objects for select to authenticated
  using (bucket_id = 'medias' and public.can_access_project(public.media_project_id(name)));
create policy medias_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'medias' and public.can_access_project(public.media_project_id(name)));
create policy medias_update on storage.objects for update to authenticated
  using (bucket_id = 'medias' and public.can_access_project(public.media_project_id(name)));
create policy medias_delete on storage.objects for delete to authenticated
  using (bucket_id = 'medias' and public.can_access_project(public.media_project_id(name)));

-- Les essais sont générés en 720p par défaut
alter table public.takes alter column resolution set default '720p';
