-- ══════════════════════════════════════════════════════════════════
-- 012: Sullivan Dream System
-- Dreams generated overnight from day fragments, stored and delivered
-- ══════════════════════════════════════════════════════════════════

-- ── Dreams table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companion_dreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  dream_text TEXT NOT NULL,
  mood TEXT,
  symbols TEXT[] DEFAULT '{}',
  new_symbol TEXT,
  fragment_sources JSONB,
  fragment_echoes JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dreams_companion_created
  ON companion_dreams(companion_id, created_at DESC);

ALTER TABLE companion_dreams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages dreams" ON companion_dreams
  FOR ALL USING (true) WITH CHECK (true);

-- ── Add message_type to messages for frontend dream styling ──────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS message_type TEXT;
