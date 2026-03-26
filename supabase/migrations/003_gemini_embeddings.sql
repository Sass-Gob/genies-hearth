-- Migrate embeddings to Gemini gemini-embedding-001 (3072 dimensions)

ALTER TABLE memories DROP COLUMN IF EXISTS embedding;
ALTER TABLE memories ADD COLUMN embedding extensions.vector(3072);

-- Semantic search function: returns memories ranked by similarity × importance
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding extensions.vector(3072),
  match_companion_id text,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  companion_id text,
  content text,
  importance float8,
  similarity float8
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id,
    m.companion_id,
    m.content,
    m.importance,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memories m
  WHERE m.companion_id = match_companion_id
    AND m.embedding IS NOT NULL
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY (1 - (m.embedding <=> query_embedding)) * m.importance DESC
  LIMIT match_count;
$$;
