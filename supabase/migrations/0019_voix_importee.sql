-- Voix off audio importée telle quelle (ElevenLabs, micro…) depuis l'onglet Plans, pour le lip-sync et le montage.
-- Elle est rangée dans voix_creations comme une voix du studio (statut « terminee », sans calcul RunPod ni coût) ;
-- « source » dit d'où elle vient. Les droits restent ceux de voix_creations (can_access_project).
alter table public.voix_creations
  add column if not exists source text not null default 'studio';
alter table public.voix_creations drop constraint if exists voix_creations_source_check;
alter table public.voix_creations add constraint voix_creations_source_check
  check (source in ('studio', 'importee'));
comment on column public.voix_creations.source is 'studio = calculée par le serveur voix (ou enregistrement du studio voix) ; importee = voix off finale importée depuis l''onglet Plans';
