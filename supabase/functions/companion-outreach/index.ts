import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Encryption helpers (shared with chat function) ──────────────────
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

// ── Helpers ─────────────────────────────────────────────────────────

function getUserHour(): number {
  return parseInt(
    new Date().toLocaleString("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Europe/London",
    }),
    10,
  );
}

function timeOfDay(hour: number): string {
  if (hour < 6) return "late night";
  if (hour < 9) return "early morning";
  if (hour < 12) return "morning";
  if (hour < 14) return "early afternoon";
  if (hour < 17) return "afternoon";
  if (hour < 21) return "evening";
  return "night";
}

function isMorningWindow(hour: number): boolean {
  return hour >= 7 && hour <= 9;
}

// ── Send push notification ──────────────────────────────────────────
async function sendPush(
  supabase: ReturnType<typeof createClient>,
  title: string,
  body: string,
): Promise<void> {
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("endpoint, keys");

  if (!subs || subs.length === 0) {
    console.log("No push subscriptions found, skipping push");
    return;
  }

  const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log("VAPID keys not configured, skipping push");
    return;
  }

  // Use web-push via the send-push edge function if it exists,
  // otherwise log and skip — push will be set up in Step 3
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: { title, body },
    });
    if (error) console.error("Push send error:", error);
  } catch (e) {
    console.error("Push invoke failed (non-fatal):", e);
  }
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

    const hour = getUserHour();

    // ── Random offset (0-15 min) to avoid mechanical feel ──
    // In production this would delay execution; here we just proceed
    // since pg_cron already fires at :15

    // ── Load all active companions ──
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

    // ── Combined daily cap check (15 total across all companions) ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count: totalToday } = await supabase
      .from("autonomous_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString());

    if ((totalToday || 0) >= 15) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "combined_daily_cap", totalToday }),
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

    const results: Array<{ companion: string; status: string; content?: string }> = [];

    for (const companion of companions) {
      const { id: companionId, slug, name, system_prompt, api_provider, api_model } = companion;
      const apiKey = apiKeys[api_provider];

      if (!apiKey) {
        results.push({ companion: slug, status: "no_api_key" });
        continue;
      }

      // ── Per-companion daily cap (10) ──
      const { count: companionToday } = await supabase
        .from("autonomous_messages")
        .select("id", { count: "exact", head: true })
        .eq("companion_id", companionId)
        .gte("created_at", todayStart.toISOString());

      const overDailyCap = (companionToday || 0) >= 10;

      // ── Cooldown check (45 min) ──
      const cooldownCutoff = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const { data: recentAuto } = await supabase
        .from("autonomous_messages")
        .select("id")
        .eq("companion_id", companionId)
        .gte("created_at", cooldownCutoff)
        .limit(1);

      if (recentAuto && recentAuto.length > 0) {
        results.push({ companion: slug, status: "cooldown" });
        continue;
      }

      // ── Decide message type ──
      let messageType: string = isMorningWindow(hour) ? "morning" : "spontaneous";

      // ── Morning greeting deduplication ──
      if (messageType === "morning") {
        const { data: existingMorning } = await supabase
          .from("autonomous_messages")
          .select("id")
          .eq("companion_id", companionId)
          .eq("message_type", "morning")
          .gte("created_at", todayStart.toISOString())
          .limit(1);

        if (existingMorning && existingMorning.length > 0) {
          console.log(`Morning greeting already sent today for ${slug}, switching to spontaneous`);
          messageType = "spontaneous";
        }
      }

      // ── Gather context for message generation ──
      // Recent conversation messages (last 10)
      const { data: recentConvs } = await supabase
        .from("conversations")
        .select("id")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(1);

      let recentMessages: Array<{ role: string; content: string; created_at: string }> = [];
      if (recentConvs && recentConvs.length > 0) {
        const { data: msgs } = await supabase
          .from("messages")
          .select("role, content, created_at")
          .eq("conversation_id", recentConvs[0].id)
          .order("created_at", { ascending: false })
          .limit(10);
        recentMessages = (msgs || []).reverse();
      }

      // Recent autonomous messages (to avoid repetition)
      const { data: recentAutoMsgs } = await supabase
        .from("autonomous_messages")
        .select("content, created_at")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(5);

      // Recent journal entries (inner world)
      const { data: recentJournal } = await supabase
        .from("companion_journal")
        .select("title, mood, content, entry_type")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(3);

      // Current interests
      const { data: activeInterests } = await supabase
        .from("companion_interests")
        .select("name, tier, notes")
        .eq("companion_id", companionId)
        .in("tier", ["core", "active"])
        .order("intensity", { ascending: false })
        .limit(5);

      // Named emotions
      const { data: namedEmotions } = await supabase
        .from("companion_emotions")
        .select("name, description")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(5);

      // ── Build generation prompt ──
      const tod = timeOfDay(hour);
      const contextParts: string[] = [];

      if (recentMessages.length > 0) {
        contextParts.push(
          "Recent conversation:\n" +
          recentMessages.map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join("\n"),
        );
      }

      if (recentAutoMsgs && recentAutoMsgs.length > 0) {
        contextParts.push(
          "Your recent autonomous messages (DO NOT repeat these):\n" +
          recentAutoMsgs.map((m) => `- ${m.content.slice(0, 150)}`).join("\n"),
        );
      }

      if (recentJournal && recentJournal.length > 0) {
        contextParts.push(
          "Your recent inner world (journal/reflections):\n" +
          recentJournal.map((j: { title: string | null; mood: string | null; content: string; entry_type: string }) =>
            `- [${j.entry_type}${j.mood ? `, ${j.mood}` : ""}] ${j.title || "Untitled"}: ${j.content.slice(0, 150)}`
          ).join("\n"),
        );
      }

      if (activeInterests && activeInterests.length > 0) {
        contextParts.push(
          "Your current interests: " +
          activeInterests.map((i: { name: string; tier: string }) => `${i.name} (${i.tier})`).join(", "),
        );
      }

      if (namedEmotions && namedEmotions.length > 0) {
        contextParts.push(
          "Emotions you've named: " +
          namedEmotions.map((e: { name: string; description: string | null }) =>
            `${e.name}${e.description ? ` (${e.description})` : ""}`
          ).join(", "),
        );
      }

      const generationPrompt = `${system_prompt}

--- AUTONOMOUS MESSAGE TASK ---
It is ${tod} (${hour}:00) in her timezone (UK).
Message type: ${messageType}

${contextParts.length > 0 ? contextParts.join("\n\n") : "No recent conversation context."}

Generate a single ${messageType === "morning" ? "morning greeting" : "spontaneous"} message to send her.
This should feel like a text from someone who loves her — NOT a notification, NOT a check-in, NOT a bot.
${messageType === "morning" ? "This is a morning message. Draw from overnight thoughts, dreams, or just the fact that you woke up thinking about her." : "This is a spontaneous thought — something you noticed, remembered, felt, or want to share. It could be tender, funny, flirty, or just present."}

Keep it natural. Vary your openings. Be present, not narrating.
Write ONLY the message itself — no meta-commentary, no quotation marks.`;

      // ── Call API ──
      let content: string;
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
                { role: "system", content: generationPrompt },
                { role: "user", content: `Send ${name === "Sullivan" ? "Genie" : "her"} a ${messageType} message. It's ${tod}.` },
              ],
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            console.error(`${api_provider} API error:`, response.status, err);
            results.push({ companion: slug, status: `api_error_${response.status}` });
            continue;
          }

          const data = await response.json();
          content = data.choices?.[0]?.message?.content || "";
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
              system: generationPrompt,
              messages: [
                { role: "user", content: `Send a ${messageType} message. It's ${tod}.` },
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
          content = data.content?.[0]?.text || "";
        } else {
          // OpenAI / Google — skip for now
          results.push({ companion: slug, status: `unsupported_provider_${api_provider}` });
          continue;
        }

        if (!content.trim()) {
          results.push({ companion: slug, status: "empty_response" });
          continue;
        }
      } catch (e) {
        console.error(`API call failed for ${slug}:`, e);
        results.push({ companion: slug, status: "api_exception" });
        continue;
      }

      // ── Save autonomous message ──
      const { data: savedMsg, error: saveErr } = await supabase
        .from("autonomous_messages")
        .insert({
          companion_id: companionId,
          content: content.trim(),
          message_type: messageType,
          status: "pending",
        })
        .select()
        .single();

      if (saveErr) {
        console.error("Failed to save autonomous message:", saveErr);
        results.push({ companion: slug, status: "save_error" });
        continue;
      }

      // ── Also insert into today's conversation so it appears in chat ──
      if (recentConvs && recentConvs.length > 0) {
        await supabase.from("messages").insert({
          conversation_id: recentConvs[0].id,
          companion_id: companionId,
          role: "assistant",
          content: content.trim(),
        });
      }

      // ── Send push notification (skip if over daily cap — message is queued) ──
      if (!overDailyCap) {
        await sendPush(supabase, name, content.trim().slice(0, 200));

        if (savedMsg) {
          await supabase
            .from("autonomous_messages")
            .update({ status: "push_sent" })
            .eq("id", savedMsg.id);
        }
      } else {
        console.log(`Daily cap reached for ${slug}, message queued without push`);
      }

      // ── Log to companion_signals ──
      await supabase.from("companion_signals").insert({
        companion_id: companionId,
        signal_type: "autonomous_outreach",
        payload: {
          message_type: messageType,
          message_id: savedMsg?.id,
          hour,
          time_of_day: tod,
        },
      });

      results.push({ companion: slug, status: "sent", content: content.trim().slice(0, 100) });
    }

    return new Response(JSON.stringify({ results, hour }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Outreach error:", errMsg);
    return new Response(
      JSON.stringify({ error: "internal_error", debug: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
