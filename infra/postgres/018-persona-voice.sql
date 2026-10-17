ALTER TABLE agent_personas
  ADD COLUMN IF NOT EXISTS voice_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_language text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS voice_rate numeric NOT NULL DEFAULT 1 CHECK (voice_rate BETWEEN 0.5 AND 2),
  ADD COLUMN IF NOT EXISTS voice_pitch numeric NOT NULL DEFAULT 1 CHECK (voice_pitch BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS voice_volume numeric NOT NULL DEFAULT 1 CHECK (voice_volume BETWEEN 0 AND 1);

ALTER TABLE persona_versions
  ADD COLUMN IF NOT EXISTS voice_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS voice_language text NOT NULL DEFAULT 'en-US',
  ADD COLUMN IF NOT EXISTS voice_rate numeric NOT NULL DEFAULT 1 CHECK (voice_rate BETWEEN 0.5 AND 2),
  ADD COLUMN IF NOT EXISTS voice_pitch numeric NOT NULL DEFAULT 1 CHECK (voice_pitch BETWEEN 0 AND 2),
  ADD COLUMN IF NOT EXISTS voice_volume numeric NOT NULL DEFAULT 1 CHECK (voice_volume BETWEEN 0 AND 1);
