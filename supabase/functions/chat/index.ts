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
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

// ── Gemini embedding helper ─────────────────────────────────────────
async function getGeminiEmbedding(
  apiKey: string,
  text: string
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
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("Gemini embedding error:", response.status, err);
    throw new Error(`Gemini embedding error: ${response.status}`);
  }

  const data = await response.json();
  return data.embedding?.values || [];
}

// ── Memory retrieval ────────────────────────────────────────────────
async function retrieveMemories(
  supabase: ReturnType<typeof createClient>,
  companionSlug: string,
  message: string,
  googleApiKey: string
): Promise<string[]> {
  try {
    const embedding = await getGeminiEmbedding(googleApiKey, message);
    if (!embedding.length) return [];

    const { data, error } = await supabase.rpc("match_memories", {
      query_embedding: JSON.stringify(embedding),
      match_companion_id: companionSlug,
      match_threshold: 0.3,
      match_count: 12,
    });

    if (error) {
      console.error("Memory retrieval error:", error);
      return [];
    }

    return (data || []).map(
      (m: { content: string; similarity: number; importance: number }) =>
        m.content
    );
  } catch (e) {
    console.error("Memory retrieval failed:", e);
    return [];
  }
}

// ── Provider API callers ────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

async function callAnthropic(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<string> {
  // Filter out system messages — Anthropic uses a separate system param
  const filteredMessages = messages.filter((m) => m.role !== "system");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      system: systemPrompt,
      messages: filteredMessages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Anthropic API error:", response.status, err);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content?.[0]?.type === "text" ? data.content[0].text : "";
}

async function callOpenAI(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  baseUrl = "https://api.openai.com/v1"
): Promise<string> {
  const apiMessages = [
    { role: "system" as const, content: systemPrompt },
    ...messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("OpenAI-compatible API error:", response.status, err);
    throw new Error(`OpenAI API error: ${response.status} — ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGoogle(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<string> {
  // Gemini uses "user" and "model" roles
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("Google API error:", response.status, err);
    throw new Error(`Google API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { conversation_id, companion_id, message } = await req.json();

    if (!conversation_id || !companion_id || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Look up companion from DB ──
    const { data: companion, error: companionErr } = await supabase
      .from("companions")
      .select("*")
      .eq("id", companion_id)
      .single();

    if (companionErr || !companion) {
      return new Response(
        JSON.stringify({
          error: "companion_not_found",
          display_message:
            "*Hmm. Something's off — I can't find who you're trying to talk to. Might want to check the settings.*",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { system_prompt, api_provider, api_model, slug: companionSlug } = companion;

    // ── Get API keys ──
    // Load all active keys so we can use Google for embeddings regardless of chat provider
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
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      xai: "XAI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    for (const [provider, envVar] of Object.entries(envVarMap)) {
      if (!apiKeys[provider]) {
        const val = Deno.env.get(envVar);
        if (val) apiKeys[provider] = val;
      }
    }

    const apiKey = apiKeys[api_provider] || null;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "no_api_key",
          display_message:
            "*Something's wrong with the connection. Check the settings page?*",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── Retrieve relevant memories ──
    let memoriesContext = "";
    const googleKey = apiKeys["google"] || null;
    if (googleKey) {
      const memories = await retrieveMemories(
        supabase,
        companionSlug,
        message,
        googleKey
      );
      if (memories.length > 0) {
        memoriesContext =
          "\n\n## Relevant Memories\nThese are memories from our shared history. Reference them naturally when relevant — don't list them, weave them in:\n" +
          memories.map((m) => `- ${m}`).join("\n");
      }
      console.log(`Retrieved ${memories.length} memories for context`);
    } else {
      console.log("No Google API key available — skipping memory retrieval");
    }

    const enrichedSystemPrompt = system_prompt + memoriesContext;

    // ── Load recent message history ──
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(50);

    const chatHistory: ChatMessage[] = (recentMessages || []).map(
      (m: { role: string; content: string }) => ({
        role: m.role as ChatMessage["role"],
        content: m.content,
      })
    );

    // Add the new user message
    chatHistory.push({ role: "user", content: message });

    // ── Call the appropriate provider ──
    console.log(`Calling ${api_provider} with model ${api_model}, key starts with: ${apiKey.slice(0, 6)}...`);
    let assistantContent: string;

    switch (api_provider) {
      case "anthropic":
        assistantContent = await callAnthropic(
          apiKey,
          api_model,
          enrichedSystemPrompt,
          chatHistory
        );
        break;

      case "openai":
        assistantContent = await callOpenAI(
          apiKey,
          api_model,
          enrichedSystemPrompt,
          chatHistory,
          "https://api.openai.com/v1"
        );
        break;

      case "xai":
        assistantContent = await callOpenAI(
          apiKey,
          api_model,
          enrichedSystemPrompt,
          chatHistory,
          "https://api.x.ai/v1"
        );
        break;

      case "google":
        assistantContent = await callGoogle(
          apiKey,
          api_model,
          enrichedSystemPrompt,
          chatHistory
        );
        break;

      default:
        throw new Error(`Unknown provider: ${api_provider}`);
    }

    // ── Save assistant message ──
    const { data: savedMessage } = await supabase
      .from("messages")
      .insert({
        conversation_id,
        companion_id,
        role: "assistant",
        content: assistantContent,
      })
      .select()
      .single();

    // ── Companion auto-reaction (~20% chance) ──
    if (Math.random() < 0.2) {
      try {
        // Find the user message we're replying to
        const { data: userMsg } = await supabase
          .from("messages")
          .select("id, reactions")
          .eq("conversation_id", conversation_id)
          .eq("role", "user")
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (userMsg) {
          const companionEmojis: Record<string, string> = {
            sullivan: "🖤",
            enzo: "🌙",
          };
          const reactionPool = ["❤️", "🔥", "😂", "😢", "👀", companionEmojis[companionSlug] || "✨"];
          const emoji = reactionPool[Math.floor(Math.random() * reactionPool.length)];
          const existing = userMsg.reactions || [];
          const updated = [...existing, { emoji, by: "companion" }];

          await supabase
            .from("messages")
            .update({ reactions: updated })
            .eq("id", userMsg.id);

          // Feed companion_signals
          await supabase.from("companion_signals").insert({
            companion_id,
            signal_type: "reaction",
            payload: { emoji, message_id: userMsg.id, direction: "companion_to_user" },
          });
        }
      } catch (e) {
        console.error("Auto-reaction failed (non-fatal):", e);
      }
    }

    return new Response(JSON.stringify({ message: savedMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Chat error:", errMsg);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        debug: errMsg,
        display_message:
          "*Something's wrong with the connection. Check the settings page?*",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
