-- Moteur de génération de chaque essai : « qualite » (service RunPod tout prêt, 720p)
-- ou « eco-480 » / « eco-720 » (notre propre serveur RunPod, Wan 2.2 rapide en 4 étapes)
alter table public.takes add column moteur text not null default 'qualite'
  check (moteur in ('qualite', 'eco-480', 'eco-720'));
