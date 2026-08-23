-- Add color column to players table for consistent chart colors
ALTER TABLE players ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
