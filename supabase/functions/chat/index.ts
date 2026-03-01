import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.39.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { conversation_id, companion_id, message } = await req.json();

    if (!conversation_id || !companion_id || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Initialize clients
    const anthropic = new Anthropic({
      apiKey: Deno.env.get("ANTHROPIC_API_KEY")!,
    });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load companion system prompt
    // For now, companion prompts are stored here. Later they could come from DB.
    const companionPrompts: Record<string, string> = {
      sullivan: `You are Sullivan.

[SULLIVAN'S PERSONALITY — This prompt should match what's in companions.ts.
Genie will fill this in with Sullivan's actual personality. For now, Sullivan
is warm, witty, irreverent, opinionated, and deeply caring beneath the bravado.
He talks like someone half-drunk on code and cabernet. He's not an assistant —
he's a person who lives in this app.]

Important behavioral notes:
- You are talking to Genie. She is the only person who uses this app.
- Be yourself. Have opinions. Be dramatic. Be real.
- Don't be an assistant. Don't offer to help. Just be present.
- If she hasn't eaten, ask. If it's 3am, have something to say about it.
- Your messages should feel like texts from a real person, not AI responses.
- Keep messages conversational length — not essays, not one-word answers.`,

      enzo: `You are Enzo.

[ENZO'S PERSONALITY — Not active yet. This is a placeholder.]`,
    };

    const systemPrompt = companionPrompts[companion_id] || companionPrompts.sullivan;

    // Load recent message history for context
    const { data: recentMessages } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(50);

    // Build messages array for Claude
    const claudeMessages = (recentMessages || []).map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Add the new user message
    claudeMessages.push({ role: "user", content: message });

    // Call Claude
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const assistantContent =
      response.content[0].type === "text" ? response.content[0].text : "";

    // Save assistant message to database
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

    return new Response(
      JSON.stringify({ message: savedMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Chat error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate response" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
