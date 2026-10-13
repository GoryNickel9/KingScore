-- Apply separately only after all web writers use RPCs and HTTP/JWT checks pass.
-- Deliberately outside migrations: deploying additive RPCs must not disable the old website.
BEGIN;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.plays, public.play_scores FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.replace_play_scores(uuid,jsonb) FROM PUBLIC, anon, authenticated;
COMMIT;
