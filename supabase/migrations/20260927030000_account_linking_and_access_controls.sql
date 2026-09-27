-- Collega un account a un profilo player senza cambiare user_id,
-- che continua a identificare l'account proprietario dei dati storici.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS account_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS players_account_user_id_uq
  ON public.players (account_user_id)
  WHERE account_user_id IS NOT NULL;

-- Stato globale delle registrazioni. La registrazione resta aperta dopo
-- l'applicazione della migrazione, così il comportamento esistente continua.
CREATE TABLE IF NOT EXISTS public.registration_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  registrations_open BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.registration_settings (id, registrations_open)
VALUES (TRUE, TRUE)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS update_registration_settings_updated_at ON public.registration_settings;
CREATE TRIGGER update_registration_settings_updated_at
  BEFORE UPDATE ON public.registration_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.registration_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read registration settings" ON public.registration_settings;
CREATE POLICY "Anyone can read registration settings"
  ON public.registration_settings FOR SELECT
  USING (TRUE);

DROP POLICY IF EXISTS "Admins can update registration settings" ON public.registration_settings;
CREATE POLICY "Admins can update registration settings"
  ON public.registration_settings FOR UPDATE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

GRANT SELECT ON public.registration_settings TO anon, authenticated;
GRANT UPDATE ON public.registration_settings TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_registration_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_registrations_open BOOLEAN;
BEGIN
  SELECT settings.registrations_open
    INTO v_registrations_open
    FROM public.registration_settings AS settings
    WHERE settings.id = TRUE;

  IF NOT COALESCE(v_registrations_open, FALSE) THEN
    RAISE EXCEPTION 'Registrations are closed'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_registration_window_before_insert ON auth.users;
CREATE TRIGGER enforce_registration_window_before_insert
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_registration_window();

-- I non-admin possono cambiare solo la foto del profilo player collegato.
DROP POLICY IF EXISTS "Users can insert their own players" ON public.players;
DROP POLICY IF EXISTS "Users can update their own players" ON public.players;
DROP POLICY IF EXISTS "Users can delete their own players" ON public.players;
DROP POLICY IF EXISTS "players_own" ON public.players;
DROP POLICY IF EXISTS "Users can update linked player avatar" ON public.players;
CREATE POLICY "Users can update linked player avatar"
  ON public.players FOR UPDATE
  TO authenticated
  USING (account_user_id = auth.uid())
  WITH CHECK (account_user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.guard_linked_player_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR OLD.account_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Permission denied: player account is not linked to the current user'
      USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - 'avatar_url' - 'updated_at')
      IS DISTINCT FROM (to_jsonb(OLD) - 'avatar_url' - 'updated_at') THEN
    RAISE EXCEPTION 'Players may only update their own profile image'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_linked_player_profile_update ON public.players;
CREATE TRIGGER guard_linked_player_profile_update
  BEFORE UPDATE ON public.players
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_linked_player_profile_update();

-- Giochi, partite, punteggi e rating restano pubblici in lettura,
-- ma le scritture sono riservate all'admin.
DROP POLICY IF EXISTS "Users can insert their own games" ON public.games;
DROP POLICY IF EXISTS "Users can update their own games" ON public.games;
DROP POLICY IF EXISTS "Users can delete their own games" ON public.games;
DROP POLICY IF EXISTS "games_insert" ON public.games;
DROP POLICY IF EXISTS "games_update" ON public.games;
DROP POLICY IF EXISTS "Allow authenticated users to delete games" ON public.games;
DROP POLICY IF EXISTS "Admins can manage all games" ON public.games;
CREATE POLICY "Admins can manage all games"
  ON public.games FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Users can insert their own plays" ON public.plays;
DROP POLICY IF EXISTS "Users can update their own plays" ON public.plays;
DROP POLICY IF EXISTS "Users can delete their own plays" ON public.plays;
DROP POLICY IF EXISTS "Allow authenticated users to delete plays when deleting game" ON public.plays;
DROP POLICY IF EXISTS "Admins can manage all plays" ON public.plays;
CREATE POLICY "Admins can manage all plays"
  ON public.plays FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Users can insert play_scores for their players" ON public.play_scores;
DROP POLICY IF EXISTS "Users can update play_scores for their players" ON public.play_scores;
DROP POLICY IF EXISTS "Users can delete play_scores for their players" ON public.play_scores;
DROP POLICY IF EXISTS "Users can delete play_scores for their plays" ON public.play_scores;
DROP POLICY IF EXISTS "Allow authenticated users to delete play_scores when deleting p" ON public.play_scores;
DROP POLICY IF EXISTS "play_scores_own" ON public.play_scores;
DROP POLICY IF EXISTS "Admins can manage all play scores" ON public.play_scores;
CREATE POLICY "Admins can manage all play scores"
  ON public.play_scores FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "player_ratings_own" ON public.player_ratings;
DROP POLICY IF EXISTS "Admins can manage all player ratings" ON public.player_ratings;
CREATE POLICY "Admins can manage all player ratings"
  ON public.player_ratings FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "player_general_ratings_own" ON public.player_general_ratings;
DROP POLICY IF EXISTS "Admins can manage all general ratings" ON public.player_general_ratings;
CREATE POLICY "Admins can manage all general ratings"
  ON public.player_general_ratings FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Users can insert their own elo_history" ON public.elo_history;
DROP POLICY IF EXISTS "Users can update their own elo_history" ON public.elo_history;
DROP POLICY IF EXISTS "Users can delete their own elo_history" ON public.elo_history;
DROP POLICY IF EXISTS "Admins can manage all elo history" ON public.elo_history;
CREATE POLICY "Admins can manage all elo history"
  ON public.elo_history FOR ALL
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- La funzione SECURITY DEFINER deve rispettare gli stessi permessi admin
-- applicati alle scritture dirette di punteggi.
CREATE OR REPLACE FUNCTION public.replace_play_scores(p_play_id UUID, p_scores JSONB)
RETURNS SETOF public.play_scores
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Permission denied: only admins can edit game scores'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.plays WHERE id = p_play_id) THEN
    RAISE EXCEPTION 'Play % not found', p_play_id USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.play_scores WHERE play_id = p_play_id;

  INSERT INTO public.play_scores (play_id, player_id, score, winner, position)
  SELECT
    p_play_id,
    (score_row ->> 'player_id')::UUID,
    (score_row ->> 'score')::NUMERIC,
    (score_row ->> 'winner')::BOOLEAN,
    (score_row ->> 'position')::INTEGER
  FROM jsonb_array_elements(p_scores) AS score_row;

  RETURN QUERY
    SELECT * FROM public.play_scores WHERE play_id = p_play_id ORDER BY id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.replace_play_scores(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_play_scores(UUID, JSONB) TO authenticated;

-- La moderazione commenti è stata rimossa dal pannello admin.
DROP POLICY IF EXISTS "Admins can delete any play comment" ON public.play_comments;

-- Permette di caricare/eliminare solo immagini nel proprio prefisso Storage.
-- L'admin può anche gestire le immagini caricate dall'amministrazione.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'player-images',
  'player-images',
  TRUE,
  2097152,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Users can upload their own player avatars" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload hylejo_0" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete hylejo_0" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload game images 1r8zoow_0" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete game images 1r8zoow_0" ON storage.objects;
CREATE POLICY "Users can upload their own player avatars"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'player-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
  );

DROP POLICY IF EXISTS "Users can delete their own player avatars" ON storage.objects;
CREATE POLICY "Users can delete their own player avatars"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'player-images'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
  );

DROP POLICY IF EXISTS "Admins can manage game images" ON storage.objects;
CREATE POLICY "Admins can manage game images"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'game-images'
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    bucket_id = 'game-images'
    AND (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );
