-- Commenti pubblici sulle partite, con scrittura riservata agli utenti autenticati.
CREATE TABLE public.play_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  play_id UUID NOT NULL REFERENCES public.plays(id) ON DELETE CASCADE,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL DEFAULT 'Utente',
  content TEXT NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX play_comments_play_id_created_at_idx
  ON public.play_comments (play_id, created_at);

ALTER TABLE public.play_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view play comments"
  ON public.play_comments FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can comment on plays"
  ON public.play_comments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authors can update their own play comments"
  ON public.play_comments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Authors can delete their own play comments"
  ON public.play_comments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON public.play_comments TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.play_comments TO authenticated;

-- Deriva il nome dalla sessione autenticata, così l'autore non può essere falsificato dal client.
CREATE OR REPLACE FUNCTION public.set_play_comment_author()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.author_name := COALESCE(
    NULLIF(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    NULLIF(split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1), ''),
    'Utente'
  );
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_play_comment_author_before_write
  BEFORE INSERT OR UPDATE ON public.play_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.set_play_comment_author();
