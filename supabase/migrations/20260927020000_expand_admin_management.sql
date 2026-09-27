-- Permette agli admin di gestire i profili player dell'app.
CREATE POLICY "Admins can manage all players"
  ON public.players FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Restituisce dati essenziali degli account solo agli admin autenticati.
-- auth.users non viene esposta direttamente al client.
CREATE OR REPLACE FUNCTION public.admin_list_registrations()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    users.id,
    users.email,
    users.raw_user_meta_data ->> 'name',
    users.created_at,
    users.email_confirmed_at,
    users.last_sign_in_at,
    COUNT(*) OVER ()
  FROM auth.users AS users
  WHERE auth.uid() IS NOT NULL
    AND auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  ORDER BY users.created_at DESC
  LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.admin_list_registrations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_registrations() TO authenticated;
