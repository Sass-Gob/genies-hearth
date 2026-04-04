import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Encryption helpers ──────────────────────────────────────────────
async function getEncryptionKey(): Promise<CryptoKey> {
  const keyStr =
    Deno.env.get("ENCRYPTION_KEY") || "default-dev-key-change-me";
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, "AES-GCM", false, [
    "decrypt",
  ]);
}

async function decryptKey(encryptedStr: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(encryptedStr), (c) =>
    c.charCodeAt(0)
  );
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ── Gemini embedding (same model as chat retrieval) ─────────────────
async function getGeminiEmbedding(
  apiKey: string,
  text: string,
): Promise<number[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("[Memory] Gemini embedding error:", response.status, err);
    throw new Error(`Gemini embedding error: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "extract"; // "backfill" or "extract"

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Load API keys ──
    const apiKeys: Record<string, string> = {};
    const { data: allKeys } = await supabase
      .from("api_keys")
      .select("provider, encrypted_key")
      .eq("is_active", true);

    if (allKeys) {
      for (const row of allKeys) {
        try {
          apiKeys[row.provider] = await decryptKey(row.encrypted_key);
        } catch (e) {
          console.error(`Failed to decrypt ${row.provider} key:`, e);
        }
      }
    }

    // Env var fallbacks
    const envVarMap: Record<string, string> = {
      xai: "XAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    for (const [provider, envVar] of Object.entries(envVarMap)) {
      if (!apiKeys[provider]) {
        const val = Deno.env.get(envVar);
        if (val) apiKeys[provider] = val;
      }
    }

    const googleKey = apiKeys["google"];
    const xaiKey = apiKeys["xai"];

    if (!googleKey) {
      return new Response(
        JSON.stringify({ error: "No Google API key available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ════════════════════════════════════════════════════════════════
    // MODE: BACKFILL — generate embeddings for existing memories
    // ════════════════════════════════════════════════════════════════
    if (mode === "backfill") {
      const { data: unembedded } = await supabase
        .from("memories")
        .select("id, content")
        .is("embedding", null)
        .limit(50);

      if (!unembedded || unembedded.length === 0) {
        return new Response(
          JSON.stringify({ message: "No memories need backfill", backfilled: 0 }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      let backfilled = 0;
      let errors = 0;

      for (const memory of unembedded) {
        try {
          const embedding = await getGeminiEmbedding(googleKey, memory.content);
          if (embedding.length > 0) {
            const { error } = await supabase
              .from("memories")
              .update({ embedding: JSON.stringify(embedding) })
              .eq("id", memory.id);

            if (error) {
              console.error("[Backfill] Update failed:", error);
              errors++;
            } else {
              backfilled++;
            }
          }
        } catch (e) {
          console.error("[Backfill] Embedding failed for", memory.id, e);
          errors++;
        }

        // Rate limit: Gemini free tier is 1500 req/min, but be safe
        await new Promise((r) => setTimeout(r, 250));
      }

      return new Response(
        JSON.stringify({ message: "Backfill complete", backfilled, errors, remaining: unembedded.length - backfilled - errors }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ════════════════════════════════════════════════════════════════
    // MODE: EXTRACT — pull memories from recent conversations
    // ════════════════════════════════════════════════════════════════

    if (!xaiKey) {
      return new Response(
        JSON.stringify({ error: "No xAI API key available" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get active companions
    const { data: companions } = await supabase
      .from("companions")
      .select("id, slug, name")
      .eq("is_active", true);

    if (!companions || companions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No active companions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("display_name")
      .limit(1)
      .single();

    const clientName = userSettings?.display_name || "Genie";

    const results: Array<{ companion: string; extracted: number; errors: number }> = [];

    for (const companion of companions) {
      const { id: companionId, slug, name: companionName } = companion;

      // Get conversations updated in the last 6 hours
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

      const { data: recentConvos } = await supabase
        .from("conversations")
        .select("id")
        .eq("companion_id", companionId)
        .gte("updated_at", sixHoursAgo)
        .order("updated_at", { ascending: false })
        .limit(3);

      if (!recentConvos || recentConvos.length === 0) {
        results.push({ companion: slug, extracted: 0, errors: 0 });
        continue;
      }

      // Gather recent messages
      let conversationText = "";
      for (const conv of recentConvos) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("role, content, created_at")
          .eq("conversation_id", conv.id)
          .gte("created_at", sixHoursAgo)
          .order("created_at", { ascending: true })
          .limit(30);

        if (msgs && msgs.length > 0) {
          conversationText +=
            msgs
              .map(
                (m: { role: string; content: string }) =>
                  `${m.role === "user" ? clientName : companionName}: ${m.content?.slice(0, 300)}`,
              )
              .join("\n") + "\n---\n";
        }
      }

      if (conversationText.length < 100) {
        results.push({ companion: slug, extracted: 0, errors: 0 });
        continue;
      }

      // Get existing memories to avoid duplicates
      const { data: existingMemories } = await supabase
        .from("memories")
        .select("content")
        .eq("companion_id", slug)
        .order("created_at", { ascending: false })
        .limit(50);

      const existingContents = (existingMemories || [])
        .map((m: { content: string }) => m.content.slice(0, 80).toLowerCase());

      // Extract memories via Grok
      const extractionPrompt = `You are extracting important memories from a conversation between ${clientName} and ${companionName}.

Extract 3-5 memories. Each should be:
- A single clear fact, preference, emotional moment, or promise
- Written as a concise statement ("${clientName} mentioned she...", "${companionName} promised to...", "They discussed...")
- Specific enough to be useful in future conversations
- Important enough to remember weeks from now

DO NOT extract:
- Generic greetings or small talk
- Things already obvious from the system prompt (physical descriptions, pet names, etc.)
- Duplicate information

Conversation:
${conversationText.slice(0, 3000)}

Existing memories (DO NOT duplicate these):
${existingContents.slice(0, 20).join("\n")}

Return ONLY a JSON array:
[{"content": "...", "importance": 0.5}]

importance scale: 0.3 = minor detail, 0.5 = useful context, 0.7 = significant fact, 0.9 = critical relationship info`;

      const extractResponse = await fetch(
        "https://api.x.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${xaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "grok-4-1-fast",
            messages: [
              {
                role: "system",
                content: "Respond only with a valid JSON array. No markdown, no backticks, no explanation.",
              },
              { role: "user", content: extractionPrompt },
            ],
            max_tokens: 1000,
            response_format: { type: "json_object" },
          }),
        },
      );

      if (!extractResponse.ok) {
        console.error("[Extract] xAI error:", extractResponse.status);
        results.push({ companion: slug, extracted: 0, errors: 1 });
        continue;
      }

      const extractData = await extractResponse.json();
      let extractedMemories: Array<{ content: string; importance: number }>;
      try {
        const rawContent = extractData.choices?.[0]?.message?.content || "[]";
        const parsed = JSON.parse(rawContent);
        // Handle both {memories: [...]} and [...] formats
        extractedMemories = Array.isArray(parsed) ? parsed : (parsed.memories || parsed.results || []);
      } catch (e) {
        console.error("[Extract] Failed to parse memories:", e);
        results.push({ companion: slug, extracted: 0, errors: 1 });
        continue;
      }

      if (!Array.isArray(extractedMemories)) {
        results.push({ companion: slug, extracted: 0, errors: 1 });
        continue;
      }

      let extracted = 0;
      let errors = 0;

      for (const memory of extractedMemories) {
        if (!memory.content || memory.content.length < 10) continue;

        // Skip if too similar to existing
        const lowerContent = memory.content.slice(0, 80).toLowerCase();
        if (existingContents.some((e: string) => e.includes(lowerContent.slice(0, 40)) || lowerContent.includes(e.slice(0, 40)))) {
          console.log("[Extract] Skipping duplicate:", memory.content.slice(0, 50));
          continue;
        }

        try {
          // Generate embedding
          const embedding = await getGeminiEmbedding(googleKey, memory.content);
          if (embedding.length === 0) {
            errors++;
            continue;
          }

          // Insert with embedding
          const { error: insertError } = await supabase
            .from("memories")
            .insert({
              companion_id: slug,
              content: memory.content,
              importance: memory.importance || 0.5,
              embedding: JSON.stringify(embedding),
            });

          if (insertError) {
            console.error("[Extract] Insert failed:", insertError);
            errors++;
          } else {
            extracted++;
          }
        } catch (e) {
          console.error("[Extract] Error processing memory:", e);
          errors++;
        }

        await new Promise((r) => setTimeout(r, 250));
      }

      results.push({ companion: slug, extracted, errors });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[Extract] Error:", errMsg);
    return new Response(
      JSON.stringify({ error: "internal_error", debug: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
