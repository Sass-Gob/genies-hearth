import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Encryption helpers ──────────────────────────────────────────────

async function getEncryptionKey(
  mode: "encrypt" | "decrypt"
): Promise<CryptoKey> {
  const keyStr = Deno.env.get("ENCRYPTION_KEY") || "default-dev-key-change-me";
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyStr.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", keyData, "AES-GCM", false, [mode]);
}

async function encryptKey(plaintext: string): Promise<string> {
  const key = await getEncryptionKey("encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptKey(encryptedStr: string): Promise<string> {
  const key = await getEncryptionKey("decrypt");
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

function maskKey(key: string): string {
  if (key.length <= 4) return "••••";
  return "••••••••" + key.slice(-4);
}

// ── Provider test calls ─────────────────────────────────────────────

async function testAnthropicKey(apiKey: string): Promise<boolean> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  return res.ok;
}

async function testOpenAIKey(
  apiKey: string,
  baseUrl = "https://api.openai.com/v1"
): Promise<boolean> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 10,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  return res.ok;
}

async function testGoogleKey(apiKey: string): Promise<boolean> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "hi" }] }],
      }),
    }
  );
  return res.ok;
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // ── GET: List all stored keys (masked) ──
    if (req.method === "GET") {
      const { data: keys } = await supabase
        .from("api_keys")
        .select("id, provider, encrypted_key, is_active, created_at, updated_at")
        .order("provider");

      const masked = await Promise.all(
        (keys || []).map(async (k: { id: string; provider: string; encrypted_key: string; is_active: boolean; created_at: string; updated_at: string }) => {
          let maskedKey = "••••••••";
          try {
            const decrypted = await decryptKey(k.encrypted_key);
            maskedKey = maskKey(decrypted);
          } catch {
            // If decryption fails, just show dots
          }
          return {
            id: k.id,
            provider: k.provider,
            masked_key: maskedKey,
            is_active: k.is_active,
            created_at: k.created_at,
            updated_at: k.updated_at,
          };
        })
      );

      return new Response(JSON.stringify({ keys: masked }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST: Save or test a key ──
    if (req.method === "POST") {
      const body = await req.json();

      // Test action
      if (action === "test") {
        const { provider, api_key } = body;
        if (!provider || !api_key) {
          return new Response(
            JSON.stringify({ error: "Missing provider or api_key" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        let success = false;
        try {
          switch (provider) {
            case "anthropic":
              success = await testAnthropicKey(api_key);
              break;
            case "openai":
              success = await testOpenAIKey(api_key);
              break;
            case "xai":
              success = await testOpenAIKey(api_key, "https://api.x.ai/v1");
              break;
            case "google":
              success = await testGoogleKey(api_key);
              break;
            default:
              return new Response(
                JSON.stringify({ error: `Unknown provider: ${provider}` }),
                {
                  status: 400,
                  headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                  },
                }
              );
          }
        } catch (e) {
          console.error("Key test failed:", e);
          success = false;
        }

        return new Response(JSON.stringify({ success }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Save key
      const { provider, api_key } = body;
      if (!provider || !api_key) {
        return new Response(
          JSON.stringify({ error: "Missing provider or api_key" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const encrypted = await encryptKey(api_key);

      // Upsert: update if provider exists, insert if not
      const { data: existing } = await supabase
        .from("api_keys")
        .select("id")
        .eq("provider", provider)
        .single();

      if (existing) {
        await supabase
          .from("api_keys")
          .update({ encrypted_key: encrypted, is_active: true })
          .eq("id", existing.id);
      } else {
        await supabase.from("api_keys").insert({
          provider,
          encrypted_key: encrypted,
          is_active: true,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          masked_key: maskKey(api_key),
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ── DELETE: Remove a key ──
    if (req.method === "DELETE") {
      const { provider } = await req.json();
      if (!provider) {
        return new Response(
          JSON.stringify({ error: "Missing provider" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      await supabase.from("api_keys").delete().eq("provider", provider);

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("API keys error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
