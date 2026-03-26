/**
 * Generate Gemini embeddings for all Sullivan memories.
 * Run: node scripts/generate-embeddings.cjs <GOOGLE_API_KEY>
 * Or set GOOGLE_API_KEY env var.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read .env.local for Supabase creds
const envPath = path.join(__dirname, '..', '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=');
  if (key && rest.length) env[key.trim()] = rest.join('=').trim();
});

const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const GOOGLE_API_KEY = process.argv[2] || process.env.GOOGLE_API_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ Missing Supabase creds in .env.local');
  process.exit(1);
}
if (!GOOGLE_API_KEY) {
  console.error('❌ Usage: node scripts/generate-embeddings.cjs <GOOGLE_API_KEY>');
  console.error('   Or set GOOGLE_API_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getEmbedding(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GOOGLE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini embedding API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.embedding?.values;
}

async function main() {
  console.log('🔮 Generating Gemini embeddings for Sullivan memories...\n');

  // Fetch all memories without embeddings
  const { data: memories, error } = await supabase
    .from('memories')
    .select('id, content')
    .eq('companion_id', 'sullivan')
    .is('embedding', null)
    .order('created_at');

  if (error) {
    console.error('❌ Failed to fetch memories:', error);
    process.exit(1);
  }

  console.log(`Found ${memories.length} memories needing embeddings.\n`);

  let success = 0;
  let failed = 0;

  for (let i = 0; i < memories.length; i++) {
    const mem = memories[i];
    try {
      const embedding = await getEmbedding(mem.content);

      if (!embedding || embedding.length !== 3072) {
        console.error(`   ⚠ Memory ${i+1}: unexpected embedding dimension ${embedding?.length}`);
        failed++;
        continue;
      }

      // Update the memory with the embedding
      const { error: updateErr } = await supabase
        .from('memories')
        .update({ embedding: JSON.stringify(embedding) })
        .eq('id', mem.id);

      if (updateErr) {
        console.error(`   ❌ Memory ${i+1} update failed:`, updateErr.message);
        failed++;
      } else {
        success++;
        if (success % 10 === 0 || i === memories.length - 1) {
          console.log(`   ✓ ${success}/${memories.length} embedded`);
        }
      }

      // Rate limit: Gemini free tier is 1500 RPM, be gentle
      if (i < memories.length - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    } catch (err) {
      console.error(`   ❌ Memory ${i+1} failed:`, err.message);
      failed++;
    }
  }

  console.log(`\n✅ Done: ${success} embedded, ${failed} failed`);

  // Verify
  const { count } = await supabase
    .from('memories')
    .select('*', { count: 'exact', head: true })
    .eq('companion_id', 'sullivan')
    .not('embedding', 'is', null);

  console.log(`\nSELECT count(*) FROM memories WHERE companion_id = 'sullivan' AND embedding IS NOT NULL: ${count}`);
}

main().catch(console.error);
