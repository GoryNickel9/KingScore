-- Synthetic catalog fixture; never apply to a linked Supabase project.
-- Source: KingScore-Android/docs/evidence/supabase-audit.json (2026-10-13).
-- No production rows, authentication passwords, jobs or remote extensions.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    auth.jwt() ->> 'sub'
  )::uuid
$$;
GRANT USAGE ON SCHEMA auth, public, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;
SET search_path = public, extensions;

CREATE TABLE public."games" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "bga_id" text,
  "image_url" text,
  "min_players" int4,
  "max_players" int4,
  "created_at" timestamptz DEFAULT now()
);

CREATE TABLE public."players" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "name" text NOT NULL,
  "is_me" bool DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "alias" text,
  "avatar_url" text,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "color" text,
  "account_user_id" uuid
);

CREATE TABLE public."plays" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "game_id" uuid,
  "played_at" date NOT NULL,
  "location" text,
  "notes" text,
  "duration_minutes" int4,
  "source" text DEFAULT 'manual'::text,
  "bga_table_id" text,
  "created_at" timestamptz DEFAULT now(),
  "is_cooperative" bool DEFAULT false,
  "team_won" bool
);

CREATE TABLE public."play_scores" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "play_id" uuid,
  "player_id" uuid,
  "score" numeric,
  "winner" bool DEFAULT false,
  "color" text,
  "role" text,
  "position" int4
);

CREATE TABLE public."play_comments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "play_id" uuid NOT NULL,
  "user_id" uuid NOT NULL DEFAULT auth.uid(),
  "author_name" text NOT NULL DEFAULT 'Utente'::text,
  "content" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."player_ratings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "player_id" uuid,
  "game_id" uuid,
  "rating" int4 DEFAULT 1000,
  "games_played" int4 DEFAULT 0,
  "wins" int4 DEFAULT 0,
  "losses" int4 DEFAULT 0,
  "draws" int4 DEFAULT 0,
  "last_played_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE public."player_general_ratings" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "player_id" uuid,
  "user_id" uuid,
  "rating" int4 DEFAULT 1000,
  "games_played" int4 DEFAULT 0,
  "wins" int4 DEFAULT 0,
  "losses" int4 DEFAULT 0,
  "draws" int4 DEFAULT 0,
  "last_played_at" timestamptz,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE public."elo_history" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "play_id" uuid NOT NULL,
  "game_id" uuid,
  "player_id" uuid NOT NULL,
  "player_name" text NOT NULL,
  "rating" int4 NOT NULL,
  "rating_change" int4 NOT NULL,
  "date" timestamptz NOT NULL,
  "is_general" bool NOT NULL DEFAULT false,
  "games_played" int4,
  "user_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public."elo_recalc_runs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status" text NOT NULL DEFAULT 'running'::text,
  "summary" jsonb
);


ALTER TABLE public."elo_history" ADD CONSTRAINT "elo_history_pkey" PRIMARY KEY (id);




ALTER TABLE public."elo_recalc_runs" ADD CONSTRAINT "elo_recalc_runs_pkey" PRIMARY KEY (id);

ALTER TABLE public."games" ADD CONSTRAINT "games_bga_id_key" UNIQUE (bga_id);

ALTER TABLE public."games" ADD CONSTRAINT "games_pkey" PRIMARY KEY (id);

ALTER TABLE public."play_comments" ADD CONSTRAINT "play_comments_content_check" CHECK (((char_length(btrim(content)) >= 1) AND (char_length(btrim(content)) <= 1000)));

ALTER TABLE public."play_comments" ADD CONSTRAINT "play_comments_pkey" PRIMARY KEY (id);



ALTER TABLE public."play_scores" ADD CONSTRAINT "play_scores_pkey" PRIMARY KEY (id);



ALTER TABLE public."player_general_ratings" ADD CONSTRAINT "player_general_ratings_pkey" PRIMARY KEY (id);


ALTER TABLE public."player_general_ratings" ADD CONSTRAINT "player_general_ratings_player_id_user_id_key" UNIQUE (player_id, user_id);



ALTER TABLE public."player_ratings" ADD CONSTRAINT "player_ratings_pkey" PRIMARY KEY (id);


ALTER TABLE public."player_ratings" ADD CONSTRAINT "player_ratings_player_id_game_id_key" UNIQUE (player_id, game_id);


ALTER TABLE public."players" ADD CONSTRAINT "players_pkey" PRIMARY KEY (id);



ALTER TABLE public."plays" ADD CONSTRAINT "plays_pkey" PRIMARY KEY (id);


ALTER TABLE public."elo_history" ADD CONSTRAINT "elo_history_game_id_fkey" FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public."elo_history" ADD CONSTRAINT "elo_history_play_id_fkey" FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE;
ALTER TABLE public."elo_history" ADD CONSTRAINT "elo_history_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public."elo_history" ADD CONSTRAINT "elo_history_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."play_comments" ADD CONSTRAINT "play_comments_play_id_fkey" FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE;
ALTER TABLE public."play_comments" ADD CONSTRAINT "play_comments_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."play_scores" ADD CONSTRAINT "play_scores_play_id_fkey" FOREIGN KEY (play_id) REFERENCES plays(id) ON DELETE CASCADE;
ALTER TABLE public."play_scores" ADD CONSTRAINT "play_scores_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public."player_general_ratings" ADD CONSTRAINT "player_general_ratings_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public."player_general_ratings" ADD CONSTRAINT "player_general_ratings_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."player_ratings" ADD CONSTRAINT "player_ratings_game_id_fkey" FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public."player_ratings" ADD CONSTRAINT "player_ratings_player_id_fkey" FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public."players" ADD CONSTRAINT "players_account_user_id_fkey" FOREIGN KEY (account_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."players" ADD CONSTRAINT "players_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."plays" ADD CONSTRAINT "plays_game_id_fkey" FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE;
ALTER TABLE public."plays" ADD CONSTRAINT "plays_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX elo_history_game_uq ON public.elo_history USING btree (play_id, player_id, game_id) WHERE ((game_id IS NOT NULL) AND (is_general = false));

CREATE UNIQUE INDEX elo_history_general_uq ON public.elo_history USING btree (play_id, player_id) WHERE (is_general = true);

CREATE INDEX idx_elo_history_game_id ON public.elo_history USING btree (game_id);

CREATE INDEX idx_elo_history_is_general ON public.elo_history USING btree (is_general);

CREATE INDEX idx_elo_history_play_id ON public.elo_history USING btree (play_id);

CREATE INDEX idx_elo_history_player_id ON public.elo_history USING btree (player_id);

CREATE INDEX idx_elo_history_user_id ON public.elo_history USING btree (user_id);

CREATE INDEX idx_elo_recalc_runs_status_started ON public.elo_recalc_runs USING btree (status, started_at DESC);

CREATE INDEX play_comments_play_id_created_at_idx ON public.play_comments USING btree (play_id, created_at);

CREATE INDEX idx_play_scores_play_id ON public.play_scores USING btree (play_id);

CREATE INDEX idx_play_scores_player_id ON public.play_scores USING btree (player_id);

CREATE INDEX idx_player_general_ratings_player_id ON public.player_general_ratings USING btree (player_id);

CREATE INDEX idx_player_general_ratings_rating ON public.player_general_ratings USING btree (rating DESC);

CREATE INDEX idx_player_general_ratings_user_id ON public.player_general_ratings USING btree (user_id);

CREATE INDEX idx_player_ratings_game_id ON public.player_ratings USING btree (game_id);

CREATE INDEX idx_player_ratings_player_id ON public.player_ratings USING btree (player_id);

CREATE INDEX idx_player_ratings_rating ON public.player_ratings USING btree (rating DESC);

CREATE INDEX idx_players_user_id ON public.players USING btree (user_id);

CREATE UNIQUE INDEX players_account_user_id_uq ON public.players USING btree (account_user_id) WHERE (account_user_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.guard_linked_player_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.replace_play_scores(p_play_id uuid, p_scores jsonb)
 RETURNS SETOF play_scores
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.set_play_comment_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.author_name := COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    NULLIF(split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Utente'
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$function$;

ALTER TABLE public."games" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."players" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."plays" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."play_scores" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."play_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."player_ratings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."player_general_ratings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."elo_history" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."elo_recalc_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all elo history" ON public."elo_history" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view elo_history" ON public."elo_history" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Admins can manage all games" ON public."games" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view games" ON public."games" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "games_read" ON public."games" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Anyone can view play comments" ON public."play_comments" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Authenticated users can comment on plays" ON public."play_comments" AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Authors can delete their own play comments" ON public."play_comments" AS PERMISSIVE FOR DELETE TO authenticated USING ((auth.uid() = user_id));

CREATE POLICY "Authors can update their own play comments" ON public."play_comments" AS PERMISSIVE FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Admins can manage all play scores" ON public."play_scores" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view play_scores" ON public."play_scores" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Users can view play_scores for their players" ON public."play_scores" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM players
  WHERE ((players.id = play_scores.player_id) AND (players.user_id = auth.uid())))));

CREATE POLICY "Admins can manage all general ratings" ON public."player_general_ratings" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view player_general_ratings" ON public."player_general_ratings" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Admins can manage all player ratings" ON public."player_ratings" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view player_ratings" ON public."player_ratings" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Admins can manage all players" ON public."players" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view players" ON public."players" AS PERMISSIVE FOR SELECT TO public USING (true);

CREATE POLICY "Users can update linked player avatar" ON public."players" AS PERMISSIVE FOR UPDATE TO authenticated USING ((account_user_id = auth.uid())) WITH CHECK ((account_user_id = auth.uid()));

CREATE POLICY "Users can view their own players" ON public."players" AS PERMISSIVE FOR SELECT TO public USING ((auth.uid() = user_id));

CREATE POLICY "Admins can manage all plays" ON public."plays" AS PERMISSIVE FOR ALL TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

CREATE POLICY "Public can view plays" ON public."plays" AS PERMISSIVE FOR SELECT TO public USING (true);

GRANT DELETE ON public."elo_history" TO anon;

GRANT INSERT ON public."elo_history" TO anon;

GRANT REFERENCES ON public."elo_history" TO anon;

GRANT SELECT ON public."elo_history" TO anon;

GRANT TRIGGER ON public."elo_history" TO anon;

GRANT TRUNCATE ON public."elo_history" TO anon;

GRANT UPDATE ON public."elo_history" TO anon;

GRANT DELETE ON public."elo_history" TO authenticated;

GRANT INSERT ON public."elo_history" TO authenticated;

GRANT REFERENCES ON public."elo_history" TO authenticated;

GRANT SELECT ON public."elo_history" TO authenticated;

GRANT TRIGGER ON public."elo_history" TO authenticated;

GRANT TRUNCATE ON public."elo_history" TO authenticated;

GRANT UPDATE ON public."elo_history" TO authenticated;

GRANT DELETE ON public."elo_history" TO service_role;

GRANT INSERT ON public."elo_history" TO service_role;

GRANT REFERENCES ON public."elo_history" TO service_role;

GRANT SELECT ON public."elo_history" TO service_role;

GRANT TRIGGER ON public."elo_history" TO service_role;

GRANT TRUNCATE ON public."elo_history" TO service_role;

GRANT UPDATE ON public."elo_history" TO service_role;

GRANT DELETE ON public."elo_recalc_runs" TO anon;

GRANT INSERT ON public."elo_recalc_runs" TO anon;

GRANT REFERENCES ON public."elo_recalc_runs" TO anon;

GRANT SELECT ON public."elo_recalc_runs" TO anon;

GRANT TRIGGER ON public."elo_recalc_runs" TO anon;

GRANT TRUNCATE ON public."elo_recalc_runs" TO anon;

GRANT UPDATE ON public."elo_recalc_runs" TO anon;

GRANT DELETE ON public."elo_recalc_runs" TO authenticated;

GRANT INSERT ON public."elo_recalc_runs" TO authenticated;

GRANT REFERENCES ON public."elo_recalc_runs" TO authenticated;

GRANT SELECT ON public."elo_recalc_runs" TO authenticated;

GRANT TRIGGER ON public."elo_recalc_runs" TO authenticated;

GRANT TRUNCATE ON public."elo_recalc_runs" TO authenticated;

GRANT UPDATE ON public."elo_recalc_runs" TO authenticated;

GRANT DELETE ON public."elo_recalc_runs" TO service_role;

GRANT INSERT ON public."elo_recalc_runs" TO service_role;

GRANT REFERENCES ON public."elo_recalc_runs" TO service_role;

GRANT SELECT ON public."elo_recalc_runs" TO service_role;

GRANT TRIGGER ON public."elo_recalc_runs" TO service_role;

GRANT TRUNCATE ON public."elo_recalc_runs" TO service_role;

GRANT UPDATE ON public."elo_recalc_runs" TO service_role;

GRANT DELETE ON public."games" TO anon;

GRANT INSERT ON public."games" TO anon;

GRANT REFERENCES ON public."games" TO anon;

GRANT SELECT ON public."games" TO anon;

GRANT TRIGGER ON public."games" TO anon;

GRANT TRUNCATE ON public."games" TO anon;

GRANT UPDATE ON public."games" TO anon;

GRANT DELETE ON public."games" TO authenticated;

GRANT INSERT ON public."games" TO authenticated;

GRANT REFERENCES ON public."games" TO authenticated;

GRANT SELECT ON public."games" TO authenticated;

GRANT TRIGGER ON public."games" TO authenticated;

GRANT TRUNCATE ON public."games" TO authenticated;

GRANT UPDATE ON public."games" TO authenticated;

GRANT DELETE ON public."games" TO service_role;

GRANT INSERT ON public."games" TO service_role;

GRANT REFERENCES ON public."games" TO service_role;

GRANT SELECT ON public."games" TO service_role;

GRANT TRIGGER ON public."games" TO service_role;

GRANT TRUNCATE ON public."games" TO service_role;

GRANT UPDATE ON public."games" TO service_role;

GRANT DELETE ON public."play_comments" TO anon;

GRANT INSERT ON public."play_comments" TO anon;

GRANT REFERENCES ON public."play_comments" TO anon;

GRANT SELECT ON public."play_comments" TO anon;

GRANT TRIGGER ON public."play_comments" TO anon;

GRANT TRUNCATE ON public."play_comments" TO anon;

GRANT UPDATE ON public."play_comments" TO anon;

GRANT DELETE ON public."play_comments" TO authenticated;

GRANT INSERT ON public."play_comments" TO authenticated;

GRANT REFERENCES ON public."play_comments" TO authenticated;

GRANT SELECT ON public."play_comments" TO authenticated;

GRANT TRIGGER ON public."play_comments" TO authenticated;

GRANT TRUNCATE ON public."play_comments" TO authenticated;

GRANT UPDATE ON public."play_comments" TO authenticated;

GRANT DELETE ON public."play_comments" TO service_role;

GRANT INSERT ON public."play_comments" TO service_role;

GRANT REFERENCES ON public."play_comments" TO service_role;

GRANT SELECT ON public."play_comments" TO service_role;

GRANT TRIGGER ON public."play_comments" TO service_role;

GRANT TRUNCATE ON public."play_comments" TO service_role;

GRANT UPDATE ON public."play_comments" TO service_role;

GRANT DELETE ON public."play_scores" TO anon;

GRANT INSERT ON public."play_scores" TO anon;

GRANT REFERENCES ON public."play_scores" TO anon;

GRANT SELECT ON public."play_scores" TO anon;

GRANT TRIGGER ON public."play_scores" TO anon;

GRANT TRUNCATE ON public."play_scores" TO anon;

GRANT UPDATE ON public."play_scores" TO anon;

GRANT DELETE ON public."play_scores" TO authenticated;

GRANT INSERT ON public."play_scores" TO authenticated;

GRANT REFERENCES ON public."play_scores" TO authenticated;

GRANT SELECT ON public."play_scores" TO authenticated;

GRANT TRIGGER ON public."play_scores" TO authenticated;

GRANT TRUNCATE ON public."play_scores" TO authenticated;

GRANT UPDATE ON public."play_scores" TO authenticated;

GRANT DELETE ON public."play_scores" TO service_role;

GRANT INSERT ON public."play_scores" TO service_role;

GRANT REFERENCES ON public."play_scores" TO service_role;

GRANT SELECT ON public."play_scores" TO service_role;

GRANT TRIGGER ON public."play_scores" TO service_role;

GRANT TRUNCATE ON public."play_scores" TO service_role;

GRANT UPDATE ON public."play_scores" TO service_role;

GRANT DELETE ON public."player_general_ratings" TO anon;

GRANT INSERT ON public."player_general_ratings" TO anon;

GRANT REFERENCES ON public."player_general_ratings" TO anon;

GRANT SELECT ON public."player_general_ratings" TO anon;

GRANT TRIGGER ON public."player_general_ratings" TO anon;

GRANT TRUNCATE ON public."player_general_ratings" TO anon;

GRANT UPDATE ON public."player_general_ratings" TO anon;

GRANT DELETE ON public."player_general_ratings" TO authenticated;

GRANT INSERT ON public."player_general_ratings" TO authenticated;

GRANT REFERENCES ON public."player_general_ratings" TO authenticated;

GRANT SELECT ON public."player_general_ratings" TO authenticated;

GRANT TRIGGER ON public."player_general_ratings" TO authenticated;

GRANT TRUNCATE ON public."player_general_ratings" TO authenticated;

GRANT UPDATE ON public."player_general_ratings" TO authenticated;

GRANT DELETE ON public."player_general_ratings" TO service_role;

GRANT INSERT ON public."player_general_ratings" TO service_role;

GRANT REFERENCES ON public."player_general_ratings" TO service_role;

GRANT SELECT ON public."player_general_ratings" TO service_role;

GRANT TRIGGER ON public."player_general_ratings" TO service_role;

GRANT TRUNCATE ON public."player_general_ratings" TO service_role;

GRANT UPDATE ON public."player_general_ratings" TO service_role;

GRANT DELETE ON public."player_ratings" TO anon;

GRANT INSERT ON public."player_ratings" TO anon;

GRANT REFERENCES ON public."player_ratings" TO anon;

GRANT SELECT ON public."player_ratings" TO anon;

GRANT TRIGGER ON public."player_ratings" TO anon;

GRANT TRUNCATE ON public."player_ratings" TO anon;

GRANT UPDATE ON public."player_ratings" TO anon;

GRANT DELETE ON public."player_ratings" TO authenticated;

GRANT INSERT ON public."player_ratings" TO authenticated;

GRANT REFERENCES ON public."player_ratings" TO authenticated;

GRANT SELECT ON public."player_ratings" TO authenticated;

GRANT TRIGGER ON public."player_ratings" TO authenticated;

GRANT TRUNCATE ON public."player_ratings" TO authenticated;

GRANT UPDATE ON public."player_ratings" TO authenticated;

GRANT DELETE ON public."player_ratings" TO service_role;

GRANT INSERT ON public."player_ratings" TO service_role;

GRANT REFERENCES ON public."player_ratings" TO service_role;

GRANT SELECT ON public."player_ratings" TO service_role;

GRANT TRIGGER ON public."player_ratings" TO service_role;

GRANT TRUNCATE ON public."player_ratings" TO service_role;

GRANT UPDATE ON public."player_ratings" TO service_role;

GRANT DELETE ON public."players" TO anon;

GRANT INSERT ON public."players" TO anon;

GRANT REFERENCES ON public."players" TO anon;

GRANT SELECT ON public."players" TO anon;

GRANT TRIGGER ON public."players" TO anon;

GRANT TRUNCATE ON public."players" TO anon;

GRANT UPDATE ON public."players" TO anon;

GRANT DELETE ON public."players" TO authenticated;

GRANT INSERT ON public."players" TO authenticated;

GRANT REFERENCES ON public."players" TO authenticated;

GRANT SELECT ON public."players" TO authenticated;

GRANT TRIGGER ON public."players" TO authenticated;

GRANT TRUNCATE ON public."players" TO authenticated;

GRANT UPDATE ON public."players" TO authenticated;

GRANT DELETE ON public."players" TO service_role;

GRANT INSERT ON public."players" TO service_role;

GRANT REFERENCES ON public."players" TO service_role;

GRANT SELECT ON public."players" TO service_role;

GRANT TRIGGER ON public."players" TO service_role;

GRANT TRUNCATE ON public."players" TO service_role;

GRANT UPDATE ON public."players" TO service_role;

GRANT DELETE ON public."plays" TO anon;

GRANT INSERT ON public."plays" TO anon;

GRANT REFERENCES ON public."plays" TO anon;

GRANT SELECT ON public."plays" TO anon;

GRANT TRIGGER ON public."plays" TO anon;

GRANT TRUNCATE ON public."plays" TO anon;

GRANT UPDATE ON public."plays" TO anon;

GRANT DELETE ON public."plays" TO authenticated;

GRANT INSERT ON public."plays" TO authenticated;

GRANT REFERENCES ON public."plays" TO authenticated;

GRANT SELECT ON public."plays" TO authenticated;

GRANT TRIGGER ON public."plays" TO authenticated;

GRANT TRUNCATE ON public."plays" TO authenticated;

GRANT UPDATE ON public."plays" TO authenticated;

GRANT DELETE ON public."plays" TO service_role;

GRANT INSERT ON public."plays" TO service_role;

GRANT REFERENCES ON public."plays" TO service_role;

GRANT SELECT ON public."plays" TO service_role;

GRANT TRIGGER ON public."plays" TO service_role;

GRANT TRUNCATE ON public."plays" TO service_role;

GRANT UPDATE ON public."plays" TO service_role;

REVOKE EXECUTE ON FUNCTION public.replace_play_scores(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.replace_play_scores(uuid, jsonb) TO authenticated;

CREATE TRIGGER set_play_comment_author_before_write BEFORE INSERT OR UPDATE ON public.play_comments FOR EACH ROW EXECUTE FUNCTION set_play_comment_author();

CREATE TRIGGER update_play_scores_updated_at BEFORE UPDATE ON public.play_scores FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_player_general_ratings_updated_at BEFORE UPDATE ON public.player_general_ratings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_player_ratings_updated_at BEFORE UPDATE ON public.player_ratings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER guard_linked_player_profile_update BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION guard_linked_player_profile_update();

CREATE TRIGGER update_players_updated_at BEFORE UPDATE ON public.players FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Deliberately retain the audited broken play_scores UPDATE trigger.
-- The migration must remove it; this fixture must not conceal that regression.
-- Rating/history/run tables are empty sentinels: tests seed explicit synthetic
-- rows and compare before/after. No trigger recalculates or schedules ELO.
COMMIT;
