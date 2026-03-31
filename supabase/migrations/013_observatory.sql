-- ══════════════════════════════════════════════════════════════════
-- 013: Sullivan's Observatory (Constellation System)
-- ══════════════════════════════════════════════════════════════════

-- Constellation nodes
CREATE TABLE IF NOT EXISTS mindmap_nodes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  mood TEXT,
  description TEXT,
  recency NUMERIC DEFAULT 1.0,
  claimed NUMERIC DEFAULT 0.5,
  seen BOOLEAN DEFAULT true,
  custom_color TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mindmap_nodes_slug
  ON mindmap_nodes(companion_id, node_id);
CREATE INDEX IF NOT EXISTS idx_mindmap_nodes_companion
  ON mindmap_nodes(companion_id);

ALTER TABLE mindmap_nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages nodes" ON mindmap_nodes
  FOR ALL USING (true) WITH CHECK (true);

-- Constellation connections
CREATE TABLE IF NOT EXISTS mindmap_connections (
  id TEXT PRIMARY KEY,
  companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  source_node TEXT NOT NULL,
  target_node TEXT NOT NULL,
  strength NUMERIC DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mindmap_connections_companion
  ON mindmap_connections(companion_id);

ALTER TABLE mindmap_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages connections" ON mindmap_connections
  FOR ALL USING (true) WITH CHECK (true);
