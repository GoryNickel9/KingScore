BEGIN;

-- Labels are snapshots; user_id is the stable recipient, even after a rename.
ALTER TABLE public.play_comments ADD COLUMN mentions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE public.discussion_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_name text NOT NULL,
  play_id uuid NOT NULL REFERENCES public.plays(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reply', 'mention', 'reaction')),
  emoji text,
  source_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  FOREIGN KEY (comment_id, play_id) REFERENCES public.play_comments(id, play_id) ON DELETE CASCADE,
  UNIQUE (recipient_id, source_key),
  CHECK (recipient_id <> actor_id)
);
CREATE INDEX discussion_notifications_feed_idx ON public.discussion_notifications(recipient_id, created_at DESC, id DESC);
CREATE INDEX discussion_notifications_unread_idx ON public.discussion_notifications(recipient_id) WHERE read_at IS NULL;
ALTER TABLE public.discussion_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discussion_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.discussion_notifications TO authenticated;
CREATE POLICY "Read own notifications" ON public.discussion_notifications FOR SELECT TO authenticated
  USING (recipient_id = (SELECT auth.uid()));

CREATE FUNCTION public.validate_comment_mentions() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE item jsonb; ids uuid[] := '{}'; target uuid; label text;
BEGIN
  IF jsonb_typeof(NEW.mentions) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.mentions) > 10 THEN
    RAISE EXCEPTION 'Expected at most ten mentions' USING ERRCODE = '23514';
  END IF;
  -- Old clients may edit text without knowing this column: remove detached labels.
  IF TG_OP = 'UPDATE' AND NEW.mentions = OLD.mentions AND NEW.content IS DISTINCT FROM OLD.content THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO NEW.mentions
    FROM jsonb_array_elements(NEW.mentions) WHERE strpos(NEW.content, '@' || (value->>'label')) > 0;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.mentions) LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR jsonb_typeof(item->'user_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2 THEN
      RAISE EXCEPTION 'Invalid mention' USING ERRCODE = '23514';
    END IF;
    target := (item->>'user_id')::uuid; label := item->>'label';
    IF char_length(label) NOT BETWEEN 1 AND 80 OR label <> btrim(label) OR label ~ '[[:cntrl:]]'
       OR strpos(NEW.content, '@' || label) = 0 OR target = ANY(ids)
       OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target) THEN
      RAISE EXCEPTION 'Invalid mention target or label' USING ERRCODE = '23514';
    END IF;
    ids := array_append(ids, target);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_comment_mentions() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER validate_comment_mentions BEFORE INSERT OR UPDATE ON public.play_comments
  FOR EACH ROW EXECUTE FUNCTION public.validate_comment_mentions();

CREATE FUNCTION public.notify_comment_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; parent_author uuid;
BEGIN
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT user_id INTO parent_author FROM public.play_comments WHERE id = NEW.parent_comment_id;
  END IF;
  -- Removing a mention retracts its notification. Reply notifications remain.
  IF TG_OP = 'UPDATE' THEN
    DELETE FROM public.discussion_notifications n WHERE n.source_key = 'comment:' || NEW.id AND n.kind = 'mention'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mentions) m WHERE (m->>'user_id')::uuid = n.recipient_id);
  END IF;
  IF TG_OP = 'INSERT' AND parent_author IS NOT NULL AND parent_author <> NEW.user_id THEN
    INSERT INTO public.discussion_notifications(recipient_id,actor_id,actor_name,play_id,comment_id,kind,source_key)
    VALUES (parent_author,NEW.user_id,left(NEW.author_name,80),NEW.play_id,NEW.id,'reply','comment:' || NEW.id)
    ON CONFLICT (recipient_id,source_key) DO NOTHING;
  END IF;
  FOR target IN SELECT (m->>'user_id')::uuid FROM jsonb_array_elements(NEW.mentions) m LOOP
    IF target <> NEW.user_id AND (TG_OP = 'INSERT' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(OLD.mentions) m WHERE (m->>'user_id')::uuid = target)) THEN
      INSERT INTO public.discussion_notifications(recipient_id,actor_id,actor_name,play_id,comment_id,kind,source_key)
      VALUES (target,NEW.user_id,left(NEW.author_name,80),NEW.play_id,NEW.id,'mention','comment:' || NEW.id)
      ON CONFLICT (recipient_id,source_key) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_comment_activity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notify_comment_activity AFTER INSERT OR UPDATE ON public.play_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment_activity();

CREATE FUNCTION public.notify_comment_reaction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target uuid; label text; key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.discussion_notifications WHERE source_key = 'reaction:' || OLD.id;
    RETURN OLD;
  END IF;
  -- Notes have no unambiguous author; this feature notifies comment authors only.
  IF NEW.comment_id IS NULL THEN RETURN NEW; END IF;
  SELECT user_id INTO target FROM public.play_comments WHERE id = NEW.comment_id;
  IF target IS NULL OR target = NEW.user_id THEN RETURN NEW; END IF;
  SELECT left(COALESCE(nullif(btrim(raw_user_meta_data->>'name'),''),'Utente'),80) INTO label
    FROM auth.users WHERE id = NEW.user_id;
  key := 'reaction:' || NEW.id;
  INSERT INTO public.discussion_notifications(recipient_id,actor_id,actor_name,play_id,comment_id,kind,emoji,source_key)
  VALUES (target,NEW.user_id,label,NEW.play_id,NEW.comment_id,'reaction',NEW.emoji,key)
  ON CONFLICT (recipient_id,source_key) DO UPDATE SET emoji = excluded.emoji;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_comment_reaction() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notify_comment_reaction AFTER INSERT OR UPDATE OR DELETE ON public.play_reactions
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment_reaction();

CREATE FUNCTION public.search_mention_users(p_query text DEFAULT '') RETURNS TABLE(user_id uuid, label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_query IS NULL OR char_length(p_query) > 80 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE = '22023'; END IF;
  RETURN QUERY SELECT u.id, btrim(left(COALESCE(nullif(btrim(u.raw_user_meta_data->>'name'),''),'Utente'),80)) AS name
    FROM auth.users u WHERE u.id <> auth.uid()
      AND strpos(lower(COALESCE(nullif(btrim(u.raw_user_meta_data->>'name'),''),'Utente')),lower(p_query)) > 0
      AND COALESCE(u.raw_user_meta_data->>'name','') !~ '[[:cntrl:]]'
    ORDER BY name, u.id LIMIT 20;
END;
$$;

CREATE FUNCTION public.notification_feed(p_before_time timestamptz DEFAULT NULL, p_before_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE page jsonb; more boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF (p_before_time IS NULL) <> (p_before_id IS NULL) THEN RAISE EXCEPTION 'Incomplete cursor' USING ERRCODE = '22023'; END IF;
  WITH batch AS (
    SELECT id,recipient_id,actor_name,play_id,comment_id,kind,emoji,created_at,read_at
    FROM public.discussion_notifications WHERE recipient_id = auth.uid()
      AND (p_before_time IS NULL OR (created_at,id) < (p_before_time,p_before_id))
    ORDER BY created_at DESC,id DESC LIMIT 41
  ), first_page AS (SELECT * FROM batch ORDER BY created_at DESC,id DESC LIMIT 40)
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY created_at DESC,id DESC) FROM first_page f),'[]'::jsonb),
    (SELECT count(*) > 40 FROM batch) INTO page,more;
  RETURN jsonb_build_object('items',page,'has_more',more,'unread_count',
    (SELECT count(*) FROM public.discussion_notifications WHERE recipient_id = auth.uid() AND read_at IS NULL));
END;
$$;

CREATE FUNCTION public.mark_notifications_read(p_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  UPDATE public.discussion_notifications SET read_at = now()
    WHERE recipient_id = auth.uid() AND read_at IS NULL AND (p_id IS NULL OR id = p_id);
END;
$$;
REVOKE ALL ON FUNCTION public.search_mention_users(text), public.notification_feed(timestamptz,uuid), public.mark_notifications_read(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_mention_users(text), public.notification_feed(timestamptz,uuid), public.mark_notifications_read(uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
