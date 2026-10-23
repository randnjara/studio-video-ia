-- Film de promotion : le produit à promouvoir devient un genre de référence (2 ou 3 photos du même produit, même nom)
alter table public.film_refs drop constraint film_refs_genre_check;
alter table public.film_refs add constraint film_refs_genre_check
  check (genre in ('personnage', 'lieu', 'produit', 'objet', 'style'));
