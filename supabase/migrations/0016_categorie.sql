-- Catégorie du film (interview, documentaire, film, promotion, tutoriel, clip) : elle règle le découpage en plans.
-- Une interview découpée comme un clip changeait de plan toutes les 5 s.
alter table public.projects
  add column categorie text not null default 'film'
  check (categorie in ('interview', 'documentaire', 'film', 'promotion', 'tutoriel', 'clip'));

-- Plan continu : plusieurs lignes de 5 s (la limite du modèle vidéo) qui forment un seul plan à l'écran.
-- Les lignes qui se suivent avec le même numéro gardent le même cadrage et la même photo de départ.
alter table public.scenes add column plan_continu integer;
