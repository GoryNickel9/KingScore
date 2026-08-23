-- Create storage bucket for game images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'game-images',
  'game-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- NOTA: Le policy di accesso per il bucket devono essere configurate manualmente dal dashboard di Supabase
-- Segui le istruzioni nel file docs/SUPABASE_STORAGE_SETUP.md per configurare le policy

-- Le policy di accesso non possono essere create via SQL per motivi di permessi
-- Devono essere configurate manualmente nel dashboard di Supabase Storage
