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

// ── DALL-E Provider ─────────────────────────────────────────────────
async function generateWithDalle(
  openaiKey: string,
  prompt: string,
): Promise<{ base64: string; revisedPrompt: string }> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("[ImageGen] DALL-E error:", response.status, err);
    throw new Error(`DALL-E error: ${response.status}`);
  }

  const data = await response.json();
  const base64 = data.data?.[0]?.b64_json;
  const revisedPrompt = data.data?.[0]?.revised_prompt || "";
  if (!base64) throw new Error("No image in DALL-E response");

  return { base64, revisedPrompt };
}

// ── Gemini Imagen Provider ──────────────────────────────────────────
async function generateWithGemini(
  geminiKey: string,
  prompt: string,
): Promise<{ base64: string; caption: string; mimeType: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      }),
    },
  );

  if (!response.ok) {
    const err = await response.text();
    console.error("[ImageGen] Gemini error:", response.status, err);
    throw new Error(`Gemini error: ${response.status}`);
  }

  const data = await response.json();
  let base64 = "";
  let caption = "";
  let mimeType = "image/png";

  const parts = data.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part.text) {
      caption = part.text;
    } else if (part.inlineData) {
      base64 = part.inlineData.data;
      mimeType = part.inlineData.mimeType || "image/png";
    }
  }

  if (!base64) throw new Error("No image in Gemini response");
  return { base64, caption, mimeType };
}

// ── Main handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { prompt, provider, companion_id, message_id } = await req.json();

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Missing prompt" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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
    if (!apiKeys["google"]) {
      const val = Deno.env.get("GOOGLE_API_KEY");
      if (val) apiKeys["google"] = val;
    }
    if (!apiKeys["openai"]) {
      const val = Deno.env.get("OPENAI_API_KEY");
      if (val) apiKeys["openai"] = val;
    }

    const selectedProvider = provider || "gemini";
    let imageBase64: string;
    let caption = "";
    let mimeType = "image/png";

    if (selectedProvider === "dalle") {
      if (!apiKeys["openai"]) {
        return new Response(
          JSON.stringify({ error: "No OpenAI API key configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const result = await generateWithDalle(apiKeys["openai"], prompt);
      imageBase64 = result.base64;
      caption = result.revisedPrompt;
    } else {
      if (!apiKeys["google"]) {
        return new Response(
          JSON.stringify({ error: "No Google API key configured" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const result = await generateWithGemini(apiKeys["google"], prompt);
      imageBase64 = result.base64;
      caption = result.caption;
      mimeType = result.mimeType;
    }

    // ── Upload to Supabase Storage ──
    const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
    const filename = `sullivan-images/${crypto.randomUUID()}.${ext}`;
    const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));

    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(filename, imageBytes, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("[ImageGen] Upload failed:", uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from("media").getPublicUrl(filename);
    const publicUrl = urlData.publicUrl;

    // ── Log to companion_images table ──
    await supabase.from("companion_images").insert({
      companion_id: companion_id || null,
      storage_path: filename,
      public_url: publicUrl,
      prompt,
      caption: caption || null,
      provider: selectedProvider,
      source: "chat",
      message_id: message_id || null,
    });

    return new Response(
      JSON.stringify({
        image_url: publicUrl,
        caption,
        prompt,
        provider: selectedProvider,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[ImageGen] Error:", errMsg);
    return new Response(
      JSON.stringify({ error: "Image generation failed", debug: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
