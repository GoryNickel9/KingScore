BEGIN;

-- Mantiene le verifiche della pubblicazione esistente, ammettendo la nuova
-- versione matematica senza concedere accesso diretto alle tabelle al worker.
DO $upgrade$
DECLARE original_definition text; upgraded_definition text;
BEGIN
  original_definition := pg_get_functiondef('public.publish_elo_v1(jsonb)'::regprocedure);
  upgraded_definition := replace(original_definition,
    'p_publication->>''algorithm'' IS DISTINCT FROM ''kingscore-elo-legacy-v1''',
    '((p_publication->>''algorithm'') IS NULL OR (p_publication->>''algorithm'') NOT IN (''kingscore-elo-legacy-v1'', ''kingscore-elo-rules-v2''))');
  IF original_definition = upgraded_definition AND position('kingscore-elo-rules-v2' in original_definition) = 0 THEN
    RAISE EXCEPTION 'Unexpected publish_elo_v1 definition; review migration';
  END IF;
  EXECUTE upgraded_definition;
END $upgrade$;

CREATE OR REPLACE FUNCTION public.get_elo_source_v2()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE snapshot jsonb;
BEGIN
  -- v1 valida anche la presenza e unicità dell'ordine persistente dei partecipanti.
  snapshot := public.get_elo_source_v1();
  RETURN snapshot || pg_catalog.jsonb_build_object('plays', COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id::text,'game_id',p.game_id::text,'played_at',pg_catalog.to_char(p.played_at,'YYYY-MM-DD'),
      'is_cooperative',p.is_cooperative,'team_won',p.team_won,
      'games',pg_catalog.jsonb_build_object('lower_score_wins',g.lower_score_wins,'shared_score_positions',g.shared_score_positions),
      'play_scores',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',s.id::text,'player_id',s.player_id::text,'score',s.score,'winner',s.winner,
        'draw',pg_catalog.to_jsonb(s)->'draw','position',s.position,
        'players',pg_catalog.jsonb_build_object('name',player.name,'alias',player.alias)
      ) ORDER BY s.elo_ordinal) FROM public.play_scores s LEFT JOIN public.players player ON player.id=s.player_id WHERE s.play_id=p.id),'[]'::jsonb)
    ) ORDER BY p.played_at,p.id) FROM public.plays p LEFT JOIN public.games g ON g.id=p.game_id
  ),'[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_elo_rules_v2(p_publication jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE acknowledgement jsonb; output jsonb;
BEGIN
  PERFORM kingscore_elo.require_worker();
  IF p_publication->>'algorithm' IS DISTINCT FROM 'kingscore-elo-rules-v2' THEN
    RAISE EXCEPTION 'Expected kingscore-elo-rules-v2';
  END IF;
  acknowledgement := public.publish_elo_v1(p_publication);
  IF NOT EXISTS (SELECT 1 FROM kingscore_elo.head h JOIN kingscore_elo.publications p USING(publication_id)
    JOIN kingscore_elo.source_clock c ON c.singleton
    WHERE h.singleton AND p.publication_id=(p_publication->>'publicationId')::uuid AND p.source_revision=c.revision) THEN
    RETURN acknowledgement || pg_catalog.jsonb_build_object('mirrored',false);
  END IF;
  output := p_publication->'result';
  INSERT INTO public.player_ratings(game_id,player_id,rating,games_played,wins,losses,draws,last_played_at)
  SELECT game.key::uuid,(player.value->>'playerId')::uuid,(player.value->>'rating')::int,
    (player.value->>'gamesPlayed')::int,(player.value->>'wins')::int,(player.value->>'losses')::int,
    (player.value->>'draws')::int,(player.value->>'lastPlayedAt')::timestamptz
  FROM pg_catalog.jsonb_each(output->'gamePlayers') game CROSS JOIN LATERAL pg_catalog.jsonb_each(game.value) player
  WHERE game.key <> '' AND game.key <> 'null'
  ON CONFLICT(player_id,game_id) DO UPDATE SET rating=excluded.rating,games_played=excluded.games_played,
    wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,last_played_at=excluded.last_played_at;

  INSERT INTO public.player_general_ratings(user_id,player_id,rating,games_played,wins,losses,draws,last_played_at)
  SELECT owners.user_id,player.key::uuid,(player.value->>'rating')::int,(player.value->>'gamesPlayed')::int,
    (player.value->>'wins')::int,(player.value->>'losses')::int,(player.value->>'draws')::int,(player.value->>'lastPlayedAt')::timestamptz
  FROM pg_catalog.jsonb_each(output->'generalPlayers') player JOIN (
    SELECT DISTINCT p.user_id,s.player_id FROM public.plays p JOIN public.play_scores s ON s.play_id=p.id WHERE p.user_id IS NOT NULL
  ) owners ON owners.player_id=player.key::uuid
  ON CONFLICT(player_id,user_id) DO UPDATE SET rating=excluded.rating,games_played=excluded.games_played,
    wins=excluded.wins,losses=excluded.losses,draws=excluded.draws,last_played_at=excluded.last_played_at;

  DELETE FROM public.elo_history WHERE play_id IN (SELECT id FROM public.plays);
  INSERT INTO public.elo_history(play_id,game_id,player_id,player_name,rating,rating_change,date,is_general,games_played,user_id)
  SELECT h."playId",h."gameId",h."playerId",h."playerName",h.rating,h."ratingChange",h.date,false,NULL,p.user_id
  FROM pg_catalog.jsonb_to_recordset(output->'gameHistory') h("playId" uuid,"gameId" uuid,"playerId" uuid,"playerName" text,rating int,"ratingChange" int,date timestamptz)
  JOIN public.plays p ON p.id=h."playId" WHERE h."gameId" IS NOT NULL
  UNION ALL
  SELECT h."playId",NULL,h."playerId",h."playerName",h.rating,h."ratingChange",h.date,true,h."gamesPlayed",p.user_id
  FROM pg_catalog.jsonb_to_recordset(output->'generalHistory') h("playId" uuid,"playerId" uuid,"playerName" text,rating int,"ratingChange" int,date timestamptz,"gamesPlayed" int)
  JOIN public.plays p ON p.id=h."playId";

  IF EXISTS (SELECT 1 FROM public.player_ratings WHERE wins+draws+losses <> games_played)
    OR EXISTS (SELECT 1 FROM public.player_general_ratings WHERE wins+draws+losses <> games_played) THEN
    RAISE EXCEPTION 'Invalid V/P/S counters';
  END IF;
  RETURN acknowledgement || pg_catalog.jsonb_build_object('mirrored',true);
END;
$$;

REVOKE ALL ON FUNCTION public.get_elo_source_v2() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.publish_elo_rules_v2(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_elo_source_v2() TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_elo_rules_v2(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
