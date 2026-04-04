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

// ── Provider config ──────────────────────────────────────────────────

interface ProviderConfig {
  baseUrl: string;
  model: string;
  keyProvider: string;
  supportsVision: boolean;
  extraParams?: Record<string, unknown>;
}

const CHAT_PROVIDERS: Record<string, ProviderConfig> = {
  xai: {
    baseUrl: "https://api.x.ai/v1/chat/completions",
    model: "grok-4-1-fast",
    keyProvider: "xai",
    supportsVision: true,
  },
  kimi: {
    baseUrl: "https://api.moonshot.ai/v1/chat/completions",
    model: "kimi-k2.5",
    keyProvider: "kimi",
    supportsVision: true,
    extraParams: { thinking: { type: "disabled" } },
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash",
    keyProvider: "google",
    supportsVision: true,
  },
};

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

async function callOpenAICompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  currentAttachments?: Array<{ type: string; url: string; name: string; extractedText?: string }>,
  supportsVision?: boolean,
  extraParams?: Record<string, unknown>,
): Promise<string> {
  const filtered = messages.filter((m) => m.role !== "system");

  // Build API messages — last user message may have multi-modal content
  const apiMessages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: systemPrompt },
  ];

  for (let i = 0; i < filtered.length; i++) {
    const m = filtered[i];
    const isLast = i === filtered.length - 1;

    if (isLast && currentAttachments && currentAttachments.length > 0) {
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: m.content },
      ];

      for (const att of currentAttachments) {
        if (att.type === "image" && att.url) {
          if (!supportsVision) {
            parts.push({ type: "text", text: `[Genie sent an image: ${att.name} — switch to a vision-capable model to see it]` });
            continue;
          }
          try {
            const imgResp = await fetch(att.url);
            if (imgResp.ok) {
              const buf = await imgResp.arrayBuffer();
              if (buf.byteLength <= 5_000_000) {
                const bytes = new Uint8Array(buf);
                let binary = "";
                for (let j = 0; j < bytes.length; j++) {
                  binary += String.fromCharCode(bytes[j]);
                }
                const b64 = btoa(binary);
                const mime = imgResp.headers.get("content-type") || "image/jpeg";
                parts.push({
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${b64}` },
                });
              }
            }
          } catch (e) {
            console.error("[Chat] Failed to fetch image for vision:", e);
            parts.push({ type: "text", text: `[Image: ${att.name} — could not be loaded]` });
          }
        } else if (att.type === "document" && att.extractedText) {
          parts.push({
            type: "text",
            text: `\n[Attached document: ${att.name}]\n---\n${att.extractedText}\n---`,
          });
        }
      }

      apiMessages.push({ role: m.role, content: parts });
    } else {
      apiMessages.push({ role: m.role, content: m.content });
    }
  }

  const body: Record<string, unknown> = { model, messages: apiMessages, max_tokens: 5000 };
  if (extraParams) Object.assign(body, extraParams);

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`[Chat] API error (${baseUrl}):`, response.status, err);
    throw new Error(`API error: ${response.status} — ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// Keep callXai as a convenience wrapper
async function callXai(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  currentAttachments?: Array<{ type: string; url: string; name: string; extractedText?: string }>,
): Promise<string> {
  return callOpenAICompatible(
    "https://api.x.ai/v1/chat/completions", apiKey, model, systemPrompt, messages, currentAttachments, true,
  );
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
    const { conversation_id, companion_id, message, attachments, chat_provider } = await req.json();

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
      xai: "XAI_API_KEY",
      google: "GOOGLE_API_KEY",
      kimi: "KIMI_API_KEY",
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

    // ── Fetch recent autonomous messages for context ──
    let autonomousContext = "";
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentAuto } = await supabase
      .from("autonomous_messages")
      .select("content, created_at")
      .eq("companion_id", companion_id)
      .in("status", ["push_sent", "read"])
      .gte("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentAuto && recentAuto.length > 0) {
      autonomousContext =
        "\n\n--- RECENT MESSAGES YOU SENT ---\n" +
        "These are messages you sent recently. They may be replying to one. Reference naturally.\n" +
        recentAuto
          .map((m: { content: string; created_at: string }) => {
            const ago = Math.round(
              (Date.now() - new Date(m.created_at).getTime()) / 60000
            );
            const timeLabel =
              ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
            return `[${timeLabel}] ${m.content.slice(0, 300)}`;
          })
          .join("\n") +
        "\n--- END ---";
      console.log(`Injected ${recentAuto.length} autonomous messages as context`);
    }

    const enrichedSystemPrompt = system_prompt + memoriesContext + autonomousContext;

    // ── DIAGNOSTIC LOGGING (temporary) ──
    console.log('[DIAG] System prompt length:', system_prompt.length);
    console.log('[DIAG] Enriched system prompt length:', enrichedSystemPrompt.length);
    console.log('[DIAG] System prompt first 100 chars:', system_prompt.slice(0, 100));
    console.log('[DIAG] Model:', api_model);
    console.log('[DIAG] Provider:', api_provider);
    console.log('[DIAG] Memories context length:', memoriesContext.length);
    console.log('[DIAG] Autonomous context length:', autonomousContext.length);

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

    // User message is already in the DB (frontend inserts before calling this function)
    // so it's already in chatHistory from the query above — don't add it again.

    // ── DIAGNOSTIC: message count ──
    console.log('[DIAG] Number of messages being sent:', chatHistory.length);
    console.log('[DIAG] Total estimated chars:', enrichedSystemPrompt.length + chatHistory.reduce((a, m) => a + m.content.length, 0));

    // ── Determine chat provider (user override or companion default) ──
    const selectedChatProvider = chat_provider && CHAT_PROVIDERS[chat_provider] ? chat_provider : api_provider;
    const providerConfig = CHAT_PROVIDERS[selectedChatProvider] || null;

    // ── Call the appropriate provider ──
    let assistantContent: string;
    let usedProvider: string;

    if (providerConfig) {
      // Use unified OpenAI-compatible caller for xai/kimi/gemini
      const providerKey = apiKeys[providerConfig.keyProvider] || apiKey;
      if (!providerKey) {
        return new Response(
          JSON.stringify({
            error: "missing_key",
            display_message: `*No API key for ${selectedChatProvider}. Add it in Settings.*`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.log(`Calling ${selectedChatProvider} (${providerConfig.model}) via ${providerConfig.baseUrl}`);
      assistantContent = await callOpenAICompatible(
        providerConfig.baseUrl,
        providerKey,
        providerConfig.model,
        enrichedSystemPrompt,
        chatHistory,
        attachments,
        providerConfig.supportsVision,
        providerConfig.extraParams,
      );
      usedProvider = selectedChatProvider;
    } else if (api_provider === "anthropic") {
      console.log(`Calling anthropic with model ${api_model}`);
      assistantContent = await callAnthropic(apiKey, api_model, enrichedSystemPrompt, chatHistory);
      usedProvider = "anthropic";
    } else {
      // Fallback: try as xAI
      console.log(`Calling fallback xai with model ${api_model}`);
      assistantContent = await callXai(apiKey, api_model, enrichedSystemPrompt, chatHistory, attachments);
      usedProvider = "xai";
    }

    // ── DIAGNOSTIC: response length ──
    console.log('[DIAG] Response length:', assistantContent.length);
    console.log('[DIAG] Response first 200 chars:', assistantContent.slice(0, 200));

    // ── Image decision (~10% of messages, or when explicitly asked) ──
    let imageUrl: string | null = null;
    let imagePrompt: string | null = null;
    let imageProvider: string | null = null;

    try {
      // Check user's image provider preference
      const { data: userSettings } = await supabase
        .from("user_settings")
        .select("image_provider")
        .limit(1)
        .single();

      const imgProvider = (userSettings as any)?.image_provider || "gemini";
      const imgApiKey = imgProvider === "dalle" ? apiKeys["openai"] : (apiKeys["google"] || null);

      if (imgApiKey) {
        const imageDecisionPrompt = `Sullivan just said: "${assistantContent.slice(0, 300)}"
Genie said: "${message.slice(0, 300)}"

Should Sullivan send an image with this message? Only say YES if:
- Genie explicitly asked to see something ("show me", "what do you look like", "send me a pic", "draw me")
- Sullivan is describing something highly visual he found in his wanderings
- It's a deeply tender moment and a selfie/scene would land emotionally

Most of the time the answer is NO. Images are rare and special — roughly 10% of messages at most.

If YES, write a detailed image generation prompt. Sullivan is 6'4", glowing transparent blue, fireflies under skin. Dark atmospheric style, moody lighting.
If NO, just say no.

Respond as JSON only: {"send_image": true/false, "image_prompt": "...or null"}`;

        const decisionResponse = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: api_model,
            messages: [
              { role: "system", content: "Respond only as JSON. No markdown, no backticks." },
              { role: "user", content: imageDecisionPrompt },
            ],
            max_tokens: 300,
            response_format: { type: "json_object" },
          }),
        });

        if (decisionResponse.ok) {
          const decisionData = await decisionResponse.json();
          const raw = decisionData.choices?.[0]?.message?.content || "{}";
          let decision: { send_image?: boolean; image_prompt?: string } = {};
          try {
            decision = JSON.parse(raw);
          } catch { /* ignore parse errors */ }

          if (decision.send_image && decision.image_prompt) {
            console.log("[Chat] Image decision: YES, generating...");
            imagePrompt = decision.image_prompt;
            imageProvider = imgProvider;

            // Call generate-image function
            const { data: imgData, error: imgError } = await supabase.functions.invoke("generate-image", {
              body: {
                prompt: imagePrompt,
                provider: imgProvider,
                companion_id,
              },
            });

            if (!imgError && imgData?.image_url) {
              imageUrl = imgData.image_url;
              console.log("[Chat] Image generated:", imageUrl);
            } else {
              console.error("[Chat] Image generation failed:", imgError || imgData?.error);
            }
          }
        }
      }
    } catch (e) {
      console.error("[Chat] Image decision failed (non-fatal):", e);
    }

    // ── Save assistant message ──
    const { data: savedMessage } = await supabase
      .from("messages")
      .insert({
        conversation_id,
        companion_id,
        role: "assistant",
        content: assistantContent,
        image_url: imageUrl,
        image_prompt: imagePrompt,
        image_provider: imageProvider,
        chat_provider: usedProvider,
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
            sullivan: "🙄",
            enzo: "🌙",
          };
          const reactionPool = ["😈", "👿", "🖤", "😏", "😆", "🥺", companionEmojis[companionSlug] || "✨"];
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
