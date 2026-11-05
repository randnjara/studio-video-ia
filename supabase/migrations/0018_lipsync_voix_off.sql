-- Lip-sync sur la voix off (comme ElevenLabs image → vidéo + voix) : chaque plan reçoit son morceau de voix off,
-- le modèle vidéo (InfiniteTalk, serveur RunPod à part) fait bouger la bouche dessus, et la vidéo sort muette.
-- Au montage, la voix off d'origine reste sur sa propre piste audio : synchronisée, mais réglable seule.
-- (Déjà appliquée sur Supabase sous le nom 0018_lipsync_voix_off.)

-- 1. Morceau de voix off de chaque plan (voice_clips existait déjà, vide)
alter table public.voice_clips
  add column if not exists voix_creation_id uuid references public.voix_creations(id) on delete set null,
  add column if not exists debut_s numeric,
  add column if not exists fin_s numeric,
  add column if not exists texte text not null default '';
create index if not exists voice_clips_scene_idx on public.voice_clips(scene_id);
create index if not exists voice_clips_voix_creation_idx on public.voice_clips(voix_creation_id);
alter table public.voice_clips drop constraint if exists voice_clips_segment_check;
alter table public.voice_clips add constraint voice_clips_segment_check
  check (debut_s is null or fin_s is null or (debut_s >= 0 and fin_s > debut_s));

-- 2. Clip lip-sync : le son qui a guidé la bouche
alter table public.takes drop constraint if exists takes_moteur_check;
alter table public.takes add constraint takes_moteur_check
  check (moteur = any (array['qualite','eco-480','eco-720','fidele-480','lipsync']));
alter table public.takes
  add column if not exists voice_clip_id uuid references public.voice_clips(id) on delete set null,
  add column if not exists audio_path text,
  add column if not exists audio_debut_s numeric,
  add column if not exists audio_fin_s numeric,
  add column if not exists video_muette boolean not null default true;
create index if not exists takes_voice_clip_idx on public.takes(voice_clip_id);

-- 3. Serveur RunPod lip-sync (rempli quand le serveur est créé)
insert into public.reglages(cle, valeur) values ('runpod_endpoint_lipsync', '')
on conflict (cle) do nothing;

comment on column public.takes.video_muette is 'true = vidéo sans son ; la voix off est posée sur une piste audio séparée du montage';
comment on column public.voice_clips.debut_s is 'Début du morceau dans voix_creations.audio_path (secondes)';
