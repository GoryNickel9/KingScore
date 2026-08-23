-- Fix play_scores.score column:
-- 1. Drop NOT NULL constraint (scores are optional — many games don't track points)
-- 2. Change type from INTEGER to NUMERIC to support decimal scores (e.g. 10.5)

ALTER TABLE play_scores
  ALTER COLUMN score DROP NOT NULL,
  ALTER COLUMN score TYPE NUMERIC USING score::NUMERIC;
