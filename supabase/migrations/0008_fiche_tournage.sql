-- Leçons du Projet Mama : fiche de tournage par plan et grille de contrôle à la validation d'un clip

-- Ce que la photo de départ doit montrer, et ce qui sert à raccorder deux plans voisins
alter table public.scenes
  add column cadrage text not null default '',
  add column angle text not null default '',
  add column lieu text not null default '', -- nom d'une référence « lieu » si elle existe
  add column intention text not null default '',
  add column pose_debut text not null default '',
  add column pose_fin text not null default '';

-- Un clip n'est validé qu'après la grille de contrôle ; on garde qui l'a validé et quand
alter table public.takes
  add column controle jsonb,
  add column validated_by uuid references public.profiles (id) on delete set null,
  add column validated_at timestamptz;
