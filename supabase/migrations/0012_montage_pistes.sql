-- Montage à pistes : la timeline (pistes vidéo, images, audio, coupes, transitions, volumes) est gardée en JSON.
-- take_ids reste rempli avec les clips de la piste principale, pour les écrans qui l'utilisent déjà.
alter table public.montages add column timeline jsonb;

-- Le montage accepte aussi vos propres fichiers : voix off, musique, vidéos de téléphone (MP4, MOV, WebM)
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime', 'video/webm',
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac',
  'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm'
]
where id = 'medias';
