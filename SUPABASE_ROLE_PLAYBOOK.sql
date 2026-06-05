-- SUPABASE ROLE PLAYBOOK
-- Purpose: set the `role` value inside auth.users.user_metadata for existing users.
-- Usage: Open Supabase -> SQL Editor -> paste and run. You must be logged in with an account that has access to the Auth schema (the SQL editor UI user typically has the needed rights).
-- WARNING: This updates auth.users directly. Double-check user UUIDs before running.

-- 1) List current users and their metadata (run first to get UUIDs)
-- This query shows id, email and user_metadata for every user.
SELECT id, email, user_metadata
FROM auth.users
ORDER BY email;

-- 2) Example: Assign roles by user id (UUID)
-- Replace <USER_UUID> with the actual id value returned above and change 'comercio' to the intended role.
-- Valid roles in this project: 'admin', 'embajador', 'comercio', 'cadete', 'usuario'

-- Example: set role = 'admin' for one user
-- UPDATE auth.users
-- SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"admin"')
-- WHERE id = '<USER_UUID>';

-- Example: set role = 'comercio' for one user
-- UPDATE auth.users
-- SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"comercio"')
-- WHERE id = '<USER_UUID>';

-- 3) Bulk example: assign multiple roles in a single block (copy and paste and replace UUIDs)
BEGIN;
  -- Admin
  UPDATE auth.users SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"admin"') WHERE id = '00000000-0000-0000-0000-000000000001';
  -- Embajador
  UPDATE auth.users SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"embajador"') WHERE id = '00000000-0000-0000-0000-000000000002';
  -- Comercio
  UPDATE auth.users SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"comercio"') WHERE id = '00000000-0000-0000-0000-000000000003';
  -- Cadete
  UPDATE auth.users SET user_metadata = jsonb_set(coalesce(user_metadata, '{}'::jsonb), '{role}', '"cadete"') WHERE id = '00000000-0000-0000-0000-000000000004';
COMMIT;

-- 4) Verify changes: re-run the listing query or use this to check the specific users
SELECT id, email, user_metadata->>'role' AS role
FROM auth.users
WHERE id IN (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
);

-- NOTES and best practices
-- - Prefer using the Supabase Dashboard (Authentication > Users) for single edits when possible.
-- - If you automate user creation, make role assignment server-side (Edge Function with service_role key) rather than client-side.
-- - If you maintain a separate `profiles` table with a `role` column, ensure application code checks user_metadata.role first, then profiles.role as a fallback if you intentionally use both.
-- - If you need to set other user_metadata fields, use jsonb_set similarly, or update using combined json manipulation.

-- Troubleshooting
-- - If you cannot run UPDATE on auth.users due to permissions, use the Supabase Dashboard Auth UI to edit user metadata, or run the commands from a trusted environment using the service_role key via the Admin API.
