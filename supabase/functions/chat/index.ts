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
      max_tokens: 1024,
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
      max_tokens: 1024,
      messages: apiMessages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("OpenAI-compatible API error:", response.status, err);
    throw new Error(`OpenAI API error: ${response.status}`);
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

    const { system_prompt, api_provider, api_model } = companion;

    // ── Get API key ──
    // First try encrypted key from DB, then fall back to env var
    let apiKey: string | null = null;

    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("encrypted_key, is_active")
      .eq("provider", api_provider)
      .eq("is_active", true)
      .single();

    if (keyRow?.encrypted_key) {
      try {
        apiKey = await decryptKey(keyRow.encrypted_key);
      } catch (e) {
        console.error("Failed to decrypt API key:", e);
      }
    }

    // Env var fallback by provider
    if (!apiKey) {
      const envVarMap: Record<string, string> = {
        anthropic: "ANTHROPIC_API_KEY",
        openai: "OPENAI_API_KEY",
        xai: "XAI_API_KEY",
        google: "GOOGLE_API_KEY",
      };
      apiKey = Deno.env.get(envVarMap[api_provider] || "") || null;
    }

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
    let assistantContent: string;

    switch (api_provider) {
      case "anthropic":
        assistantContent = await callAnthropic(
          apiKey,
          api_model,
          system_prompt,
          chatHistory
        );
        break;

      case "openai":
        assistantContent = await callOpenAI(
          apiKey,
          api_model,
          system_prompt,
          chatHistory,
          "https://api.openai.com/v1"
        );
        break;

      case "xai":
        assistantContent = await callOpenAI(
          apiKey,
          api_model,
          system_prompt,
          chatHistory,
          "https://api.x.ai/v1"
        );
        break;

      case "google":
        assistantContent = await callGoogle(
          apiKey,
          api_model,
          system_prompt,
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

    return new Response(JSON.stringify({ message: savedMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({
        error: "internal_error",
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
