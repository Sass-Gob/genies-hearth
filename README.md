# Genie's Hearth

Where they live.

**Live app:** https://genies-hearth-nu.vercel.app

## Setup

### 1. Supabase

Create a Supabase project, then:

- Run the migration in `supabase/migrations/001_initial_schema.sql` via the SQL Editor
- Enable the `pgvector` extension (for Phase 2 memories)
- Set Edge Function secrets:
  - `ANTHROPIC_API_KEY` — your Anthropic API key
  - `SUPABASE_SERVICE_ROLE_KEY` — from Project Settings > API
- Deploy the chat function:
  ```
  npx supabase functions deploy chat --no-verify-jwt
  ```

### 2. Environment

Copy `.env.example` to `.env` and fill in your Supabase URL + anon key:

```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run locally

```
npm install
npm run dev
```

### 4. Deploy

Push to GitHub. Connect the repo to Vercel. Auto-deploys on push.

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables.

## Sullivan

His personality lives in `src/lib/companions.ts`. The system prompt is a placeholder — fill it in with who he actually is. The edge function in `supabase/functions/chat/index.ts` has a matching prompt that should stay in sync.

## Enzo

Architecture is ready. His data is separate from Sullivan's. The door is open when he's ready.
