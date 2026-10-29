-- Compte de secours « superadmin » : permet toujours d'entrer dans le studio, même si tout le reste bloque.
-- À coller dans Supabase → SQL Editor → Run, APRÈS la migration 0015_mot_de_passe.sql.
-- Remplacez MOT_DE_PASSE_ICI par le mot de passe voulu (entre les apostrophes). Ne l'enregistrez jamais dans le code.
-- Relancé plus tard, le même script remet simplement ce mot de passe (utile si le compte de secours est bloqué).
-- Supabase ne garde que le mot de passe haché (bcrypt) : il n'apparaît nulle part en clair.

do $$
declare
  mot_de_passe constant text := 'MOT_DE_PASSE_ICI';
  adresse constant text := 'randnjara+superadmin@gmail.com'; -- les e-mails arrivent dans la boîte randnjara@gmail.com
  uid uuid;
begin
  if mot_de_passe = 'MOT_DE_PASSE_ICI' or length(mot_de_passe) < 8 then
    raise exception 'Remplacez MOT_DE_PASSE_ICI par un vrai mot de passe (8 caractères au moins).';
  end if;

  select id into uid from auth.users where email = adresse;
  if uid is null then
    uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', adresse,
      extensions.crypt(mot_de_passe, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Super-admin","username":"superadmin"}',
      now(), now(), '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), uid, uid::text, 'email',
      jsonb_build_object('sub', uid::text, 'email', adresse, 'email_verified', true),
      now(), now(), now()
    );
  else
    update auth.users
    set encrypted_password = extensions.crypt(mot_de_passe, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        banned_until = null,
        updated_at = now()
    where id = uid;
  end if;

  -- Toujours responsable, actif et protégé
  update public.profiles
  set super_admin = true, role = 'responsable', active = true
  where id = uid;
end;
$$;
