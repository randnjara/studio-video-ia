-- « Re-générer » une photo de départ : ce qui n'allait pas sur la photo précédente et ce que l'on veut à la place.
-- Ces remarques sont ajoutées au prompt de la nouvelle photo (et gardées pour la prochaine fois).
alter table public.photos add column a_eviter text not null default '';
alter table public.photos add column voulu text not null default '';
