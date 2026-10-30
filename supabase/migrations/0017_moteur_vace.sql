-- Moteur « Visage fidèle » (Wan 2.2 VACE sur son propre serveur RunPod) : le visage du personnage reste le même
-- d'un clip enchaîné à l'autre
alter table public.takes drop constraint if exists takes_moteur_check;
alter table public.takes add constraint takes_moteur_check
  check (moteur in ('qualite', 'eco-480', 'eco-720', 'fidele-480'));
