BEGIN;
-- The parent must already exist, including for multi-row inserts that could otherwise form a cycle.
CREATE FUNCTION public.validate_play_comment_parent()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.parent_comment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.play_comments WHERE id = NEW.parent_comment_id AND play_id = NEW.play_id
  ) THEN
    RAISE EXCEPTION 'Reply target must be an existing comment in the same play' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER validate_play_comment_parent_before_insert BEFORE INSERT ON public.play_comments
  FOR EACH ROW EXECUTE FUNCTION public.validate_play_comment_parent();
COMMIT;
