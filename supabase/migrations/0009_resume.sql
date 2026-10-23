-- Résumé ou but du film : donné à ChatGPT avec la voix off pour préparer le tableau des plans
alter table projects add column resume text not null default '';
