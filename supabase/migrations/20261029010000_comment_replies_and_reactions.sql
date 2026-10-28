BEGIN;

ALTER TABLE public.play_comments ADD COLUMN parent_comment_id uuid;
ALTER TABLE public.play_comments ADD CONSTRAINT play_comments_id_play_unique UNIQUE (id, play_id);
ALTER TABLE public.play_comments ADD CONSTRAINT play_comments_parent_same_play_fkey
  FOREIGN KEY (parent_comment_id, play_id) REFERENCES public.play_comments (id, play_id)
  ON DELETE SET NULL (parent_comment_id);
ALTER TABLE public.play_comments ADD CONSTRAINT play_comments_not_self_reply
  CHECK (parent_comment_id IS DISTINCT FROM id);
CREATE INDEX play_comments_parent_idx ON public.play_comments (parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Links are assigned on insertion; an existing reply may only lose its parent.
-- Preserve attribution and edit time when FK deletion detaches a reply.
CREATE OR REPLACE FUNCTION public.set_play_comment_author()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.play_id IS DISTINCT FROM OLD.play_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR (NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id AND NEW.parent_comment_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Comment identity and reply target are immutable' USING ERRCODE = '23514';
    END IF;
    NEW.author_name := OLD.author_name;
    NEW.updated_at := CASE WHEN NEW.content IS DISTINCT FROM OLD.content THEN now() ELSE OLD.updated_at END;
  ELSE
    NEW.author_name := COALESCE(NULLIF(auth.jwt() -> 'user_metadata' ->> 'name', ''),
      NULLIF(split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1), ''), 'Utente');
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.play_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  play_id uuid NOT NULL REFERENCES public.plays(id) ON DELETE CASCADE,
  comment_id uuid,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji text NOT NULL CHECK (emoji IN ('👍', '❤️', '😂', '🎉', '😮', '👏', '🔥', '🤔', '😢', '😡', '🤯', '👎')),
  CONSTRAINT play_reactions_target_user_unique UNIQUE NULLS NOT DISTINCT (play_id, comment_id, user_id),
  CONSTRAINT play_reactions_comment_same_play_fkey FOREIGN KEY (comment_id, play_id)
    REFERENCES public.play_comments(id, play_id) ON DELETE CASCADE
);
CREATE INDEX play_reactions_play_idx ON public.play_reactions(play_id, id);

CREATE FUNCTION public.validate_play_reaction()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.play_id IS DISTINCT FROM OLD.play_id
    OR NEW.comment_id IS DISTINCT FROM OLD.comment_id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Reaction target and author are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.comment_id IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.plays WHERE id = NEW.play_id AND nullif(btrim(notes), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Notes are required for this reaction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_play_reaction_before_write BEFORE INSERT OR UPDATE ON public.play_reactions
  FOR EACH ROW EXECUTE FUNCTION public.validate_play_reaction();
ALTER TABLE public.play_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view play reactions" ON public.play_reactions FOR SELECT USING (true);
CREATE POLICY "Users can insert own reactions" ON public.play_reactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own reactions" ON public.play_reactions FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own reactions" ON public.play_reactions FOR DELETE TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.play_reactions TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.play_reactions TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
