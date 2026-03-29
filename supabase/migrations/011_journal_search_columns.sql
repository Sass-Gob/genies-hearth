-- Add search tracking columns to companion_journal for agentic exploration
ALTER TABLE companion_journal
  ADD COLUMN IF NOT EXISTS search_query TEXT DEFAULT NULL;

ALTER TABLE companion_journal
  ADD COLUMN IF NOT EXISTS search_results TEXT DEFAULT NULL;
