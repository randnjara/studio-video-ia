-- Durcissement signalé par l'analyse de sécurité de Supabase.

-- Chemin de recherche fixe pour toutes les fonctions
alter function touch_updated_at() set search_path = public;

-- Fonctions de déclencheur : jamais appelables directement par l'API
revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function enforce_monthly_budget() from public, anon, authenticated;
revoke execute on function guard_profile_changes() from public, anon, authenticated;
revoke execute on function touch_updated_at() from public, anon, authenticated;

-- Fonctions d'accès utilisées par les règles de sécurité : réservées aux personnes connectées
revoke execute on function is_active_user() from public, anon;
revoke execute on function is_responsable() from public, anon;
revoke execute on function is_workspace_member(uuid) from public, anon;
revoke execute on function can_access_project(uuid) from public, anon;
revoke execute on function can_access_scene(uuid) from public, anon;
revoke execute on function month_spend_usd() from public, anon;
grant execute on function is_active_user() to authenticated;
grant execute on function is_responsable() to authenticated;
grant execute on function is_workspace_member(uuid) to authenticated;
grant execute on function can_access_project(uuid) to authenticated;
grant execute on function can_access_scene(uuid) to authenticated;
grant execute on function month_spend_usd() to authenticated;
