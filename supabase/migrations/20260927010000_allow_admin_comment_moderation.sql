-- Solo gli account con ruolo server-side admin possono moderare ogni commento.
-- Il ruolo viene letto da app_metadata, non da user_metadata modificabile dal client.
CREATE POLICY "Admins can delete any play comment"
  ON public.play_comments FOR DELETE
  TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
