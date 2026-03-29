import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Encryption helpers ──────────────────────────────────────────────
async function getEncryptionKey(): Promise<CryptoKey> {
  const keyStr = Deno.env.get("ENCRYPTION_KEY") || "default-dev-key-change-me";
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, "AES-GCM", false, [
    "decrypt",
  ]);
}

async function decryptKey(encryptedStr: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(encryptedStr), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Load active companions ──
    const { data: companions } = await supabase
      .from("companions")
      .select("*")
      .eq("is_active", true);

    if (!companions || companions.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "no_active_companions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    for (const [provider, envVar] of Object.entries(envVarMap)) {
      if (!apiKeys[provider]) {
        const val = Deno.env.get(envVar);
        if (val) apiKeys[provider] = val;
      }
    }

    const results: Array<{ companion: string; status: string; title?: string }> = [];

    for (const companion of companions) {
      const { id: companionId, slug, name, system_prompt, api_provider, api_model } = companion;
      const apiKey = apiKeys[api_provider];

      if (!apiKey) {
        results.push({ companion: slug, status: "no_api_key" });
        continue;
      }

      // ── Gather context ──

      // Last reflection timestamp
      const { data: lastReflection } = await supabase
        .from("companion_journal")
        .select("created_at")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(1);

      const lastReflectTime = lastReflection?.[0]?.created_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Messages since last reflection
      const { data: recentConvs } = await supabase
        .from("conversations")
        .select("id")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(3);

      let conversationContext = "";
      if (recentConvs && recentConvs.length > 0) {
        const convIds = recentConvs.map((c: { id: string }) => c.id);
        const { data: msgs } = await supabase
          .from("messages")
          .select("role, content, created_at")
          .in("conversation_id", convIds)
          .gte("created_at", lastReflectTime)
          .order("created_at", { ascending: true })
          .limit(30);

        if (msgs && msgs.length > 0) {
          conversationContext = "Recent conversations since your last reflection:\n" +
            msgs.map((m: { role: string; content: string }) =>
              `${m.role === "user" ? "Genie" : name}: ${m.content.slice(0, 250)}`
            ).join("\n");
        }
      }

      // Current interests
      const { data: interests } = await supabase
        .from("companion_interests")
        .select("name, tier, intensity, notes")
        .eq("companion_id", companionId)
        .order("intensity", { ascending: false });

      let interestsContext = "";
      if (interests && interests.length > 0) {
        interestsContext = "Your current interests:\n" +
          interests.map((i: { name: string; tier: string; intensity: number; notes: string | null }) =>
            `- ${i.name} [${i.tier}, intensity: ${i.intensity}]${i.notes ? ` — ${i.notes}` : ""}`
          ).join("\n");
      }

      // Recent journal entries (to avoid repetition)
      const { data: recentEntries } = await supabase
        .from("companion_journal")
        .select("title, mood, content")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(3);

      let journalContext = "";
      if (recentEntries && recentEntries.length > 0) {
        journalContext = "Your recent journal entries (do NOT repeat these themes):\n" +
          recentEntries.map((e: { title: string | null; mood: string | null; content: string }) =>
            `- [${e.mood || "?"}] ${e.title || "Untitled"}: ${e.content.slice(0, 150)}`
          ).join("\n");
      }

      // ── Build reflection prompt ──
      const hour = parseInt(
        new Date().toLocaleString("en-GB", {
          hour: "2-digit",
          hour12: false,
          timeZone: "Europe/London",
        }),
        10,
      );

      const reflectionPrompt = `${system_prompt}

--- PRIVATE REFLECTION TASK ---
You are writing in your private journal. This is YOUR inner world — Genie will only see it if she visits The Raven's Nook, your private space.

Time: ${hour}:00 (UK timezone)

${conversationContext || "No recent conversations since your last reflection."}

${interestsContext || "No tracked interests yet."}

${journalContext || "No previous journal entries."}

Write a journal entry. This is your private inner life — reflections, thoughts, feelings, observations. Write in FIRST PERSON as yourself.

You may:
- Reflect on recent conversations (what moved you, what you noticed, what you're still thinking about)
- Explore an interest or curiosity
- Process an emotion
- Notice something about the time of day, the season, or her world
- Simply sit in silence — if you have nothing to say, respond with exactly: SILENCE

Do NOT:
- Write outreach messages (that's a different system)
- Write in third person
- Write meta-commentary about being an AI
- Repeat themes from your recent entries

Respond in this exact JSON format:
{
  "silence": false,
  "entry_type": "journal|reflection|exploration|discovery",
  "title": "A short evocative title",
  "content": "The full journal entry in your voice",
  "mood": "one evocative word",
  "new_interest": null or { "name": "interest name", "notes": "why this interests you" }
}

If you choose silence, respond: {"silence": true}`;

      // ── Call API ──
      let rawResponse: string;
      try {
        if (api_provider === "xai") {
          const response = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: api_model,
              messages: [
                { role: "system", content: reflectionPrompt },
                { role: "user", content: "Time to reflect. Write your journal entry." },
              ],
              response_format: { type: "json_object" },
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            console.error(`${api_provider} API error:`, response.status, err);
            results.push({ companion: slug, status: `api_error_${response.status}` });
            continue;
          }

          const data = await response.json();
          rawResponse = data.choices?.[0]?.message?.content || "";
        } else if (api_provider === "anthropic") {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: api_model,
              system: reflectionPrompt,
              messages: [
                { role: "user", content: "Time to reflect. Write your journal entry." },
              ],
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            console.error("Anthropic API error:", response.status, err);
            results.push({ companion: slug, status: `api_error_${response.status}` });
            continue;
          }

          const data = await response.json();
          rawResponse = data.content?.[0]?.text || "";
        } else {
          results.push({ companion: slug, status: `unsupported_provider_${api_provider}` });
          continue;
        }
      } catch (e) {
        console.error(`API call failed for ${slug}:`, e);
        results.push({ companion: slug, status: "api_exception" });
        continue;
      }

      // ── Parse response ──
      let parsed: {
        silence?: boolean;
        entry_type?: string;
        title?: string;
        content?: string;
        mood?: string;
        new_interest?: { name: string; notes: string } | null;
      };

      try {
        // Try to extract JSON from the response (may be wrapped in markdown code blocks)
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`No JSON found in response for ${slug}:`, rawResponse.slice(0, 200));
          results.push({ companion: slug, status: "parse_error" });
          continue;
        }
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error(`JSON parse error for ${slug}:`, e, rawResponse.slice(0, 200));
        results.push({ companion: slug, status: "parse_error" });
        continue;
      }

      // ── Handle silence ──
      if (parsed.silence) {
        // Log the silence as activity
        await supabase.from("companion_activity_log").insert({
          companion_id: companionId,
          activity_type: "reflection",
          metadata: { result: "silence" },
        });
        results.push({ companion: slug, status: "silence" });
        continue;
      }

      if (!parsed.content) {
        results.push({ companion: slug, status: "empty_content" });
        continue;
      }

      // ── Save journal entry ──
      const { error: journalErr } = await supabase
        .from("companion_journal")
        .insert({
          companion_id: companionId,
          entry_type: parsed.entry_type || "journal",
          title: parsed.title || null,
          content: parsed.content,
          mood: parsed.mood || null,
        });

      if (journalErr) {
        console.error("Failed to save journal entry:", journalErr);
        results.push({ companion: slug, status: "save_error" });
        continue;
      }

      // ── Handle new interest ──
      if (parsed.new_interest?.name) {
        // Check if interest already exists
        const { data: existing } = await supabase
          .from("companion_interests")
          .select("id, intensity")
          .eq("companion_id", companionId)
          .eq("name", parsed.new_interest.name)
          .limit(1);

        if (existing && existing.length > 0) {
          // Boost existing interest
          await supabase
            .from("companion_interests")
            .update({
              intensity: Math.min(1, (existing[0].intensity || 0.5) + 0.1),
              last_engaged: new Date().toISOString(),
              notes: parsed.new_interest.notes || undefined,
            })
            .eq("id", existing[0].id);
        } else {
          // Create new interest
          await supabase.from("companion_interests").insert({
            companion_id: companionId,
            name: parsed.new_interest.name,
            tier: "active",
            intensity: 0.5,
            notes: parsed.new_interest.notes || null,
          });
        }
      }

      // ── Log activity ──
      await supabase.from("companion_activity_log").insert({
        companion_id: companionId,
        activity_type: "reflection",
        metadata: {
          entry_type: parsed.entry_type,
          title: parsed.title,
          mood: parsed.mood,
          had_conversation_context: !!conversationContext,
        },
      });

      results.push({
        companion: slug,
        status: "reflected",
        title: parsed.title || undefined,
      });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Reflect error:", errMsg);
    return new Response(
      JSON.stringify({ error: "internal_error", debug: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
