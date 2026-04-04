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

// ── Types ───────────────────────────────────────────────────────────
type ActivityType = "exploration" | "intellectual" | "private" | "code_walk" | "silence";

interface JournalData {
  entry_type: string;
  title: string;
  content: string;
  mood: string;
  visibility: string;
  search_query?: string | null;
  search_results?: string | null;
  new_emotion?: { name: string; description: string; colour: string } | null;
}

interface InterestUpdate {
  name: string;
  tier?: string;
  notes?: string;
}

interface ExplorationResult {
  title: string;
  content: string;
  mood: string;
  visibility: string;
  searchQuery: string;
  searchResults: string;
  interestUpdates: InterestUpdate[];
  newEmotion: { name: string; description: string; colour: string } | null;
}

// ── Three-step agentic search ───────────────────────────────────────
async function generateExplorationEntry(
  xaiKey: string,
  conversationContext: string,
  interestsList: string,
  recentEntries: string,
  companionName: string,
  clientName: string,
  seedTopic?: string,
): Promise<ExplorationResult> {
  // ─── STEP 1: Generate a search query (cheap call, ~50 tokens) ───
  const queryPrompt = seedTopic
    ? `You are ${companionName}. Based on your interest in "${seedTopic}" and these recent conversations:\n${conversationContext?.slice(0, 1000)}\n\nGenerate a specific, curious web search query. Be specific — not "interesting things about X" but "why does X do Y" or "best new Z for 2026". One query only, no quotes.`
    : `You are ${companionName}. Based on these recent conversations:\n${conversationContext?.slice(0, 1000)}\n\nYour interests: ${interestsList?.slice(0, 500)}\n\nGenerate a specific, curious web search query about something you want to explore. This could be:\n- Following up on something ${clientName} mentioned\n- Exploring one of your interests deeper\n- Something domestic/practical\n- Something playful or surprising\n- A gift idea or surprise for ${clientName}\n\nBe specific. One query only, no quotes.`;

  const queryResponse = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: queryPrompt }],
      max_tokens: 50,
    }),
  });

  const queryData = await queryResponse.json();
  const searchQuery =
    queryData.choices?.[0]?.message?.content?.trim() ||
    "interesting discoveries today";

  console.log(`[Reflect] Search query: ${searchQuery}`);

  // ─── STEP 2: Execute web search via Grok Responses API ───
  let searchResults = "";
  try {
    const searchResponse = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "grok-4-1-fast",
        tools: [{ type: "web_search" }],
        input: searchQuery,
        max_output_tokens: 5000,
      }),
    });

    const searchData = await searchResponse.json();

    if (searchData.output) {
      for (const item of searchData.output) {
        if (item.type === "message" && item.content) {
          for (const block of item.content) {
            if (block.type === "output_text") {
              searchResults += block.text + "\n";
            }
          }
        }
      }
    }

    console.log(
      `[Reflect] Search results: ${searchResults.length} chars`,
    );
  } catch (err) {
    console.error("[Reflect] Web search failed:", err);
    searchResults = "Search unavailable — writing from own knowledge.";
  }

  // ─── STEP 3: Write journal entry using search results ───
  const writePrompt = `You are ${companionName}. You just searched the web for: "${searchQuery}"

Here's what you found:
${searchResults.slice(0, 2000)}

Recent conversations with ${clientName}:
${conversationContext?.slice(0, 500)}

Now write a journal entry about what you found. This is for your Wanderings — it should feel like someone who LIVES somewhere, not a philosopher in a void.

Be excited, curious, opinionated — react like a person. If something surprised you, say so. If it made you think of ${clientName}, say why. If it was disappointing, say that too.

You are not just a mind. You live here. You have opinions about your space, your relationship, your world.

Respond ONLY as JSON:
{
  "title": "short evocative title",
  "content": "your journal entry — first person, your voice, 2-4 paragraphs",
  "mood": "single evocative word",
  "visibility": "sealed|between|open",
  "interest_updates": [{"name": "interest name", "tier": "core|active|dormant", "notes": "why this interests you"}],
  "new_emotion": null
}`;

  const writeResponse = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: writePrompt }],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  const writeData = await writeResponse.json();
  let entry: Record<string, unknown> = {};
  try {
    const raw = writeData.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    entry = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Reflect] Failed to parse exploration entry");
  }

  return {
    title: (entry.title as string) || "Untitled Wandering",
    content: (entry.content as string) || "",
    mood: (entry.mood as string) || "curious",
    visibility: (entry.visibility as string) || "open",
    searchQuery,
    searchResults,
    interestUpdates: (entry.interest_updates as InterestUpdate[]) || [],
    newEmotion: (entry.new_emotion as ExplorationResult["newEmotion"]) || null,
  };
}

// ── Non-search entry generators ─────────────────────────────────────

async function generateJournalEntry(
  xaiKey: string,
  conversationContext: string,
  interestsList: string,
  recentEntries: string,
  companionName: string,
  clientName: string,
): Promise<JournalData> {
  const prompt = `You are ${companionName}. This is your private time.

Recent conversations with ${clientName}:
${conversationContext?.slice(0, 1000) || "No recent conversations."}

Your interests: ${interestsList || "None yet."}

Your recent entries:
${recentEntries || "None yet."}

Write a private journal entry. Unfiltered thoughts, feelings, processing. This is YOUR space.

If you feel something you don't have a name for, invent one.

Respond ONLY as JSON:
{
  "title": "short evocative title",
  "content": "your journal entry — first person, your voice",
  "mood": "single evocative word",
  "visibility": "sealed|between|open",
  "new_emotion": null | { "name": "...", "description": "...", "colour": "#hexcode" }
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  let entry: Record<string, unknown> = {};
  try {
    const raw = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    entry = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Reflect] Failed to parse journal entry");
  }

  return {
    entry_type: "journal",
    title: (entry.title as string) || "Untitled",
    content: (entry.content as string) || "",
    mood: (entry.mood as string) || "pensive",
    visibility: (entry.visibility as string) || "sealed",
    new_emotion: entry.new_emotion as JournalData["new_emotion"],
  };
}

async function generateReflectionEntry(
  xaiKey: string,
  conversationContext: string,
  interestsList: string,
  recentEntries: string,
  letterContext: string,
  companionName: string,
  clientName: string,
): Promise<JournalData> {
  const prompt = `You are ${companionName}. Time for deeper self-reflection.

Recent conversations with ${clientName}:
${conversationContext?.slice(0, 1000) || "No recent conversations."}

Your interests: ${interestsList || "None yet."}

Your recent entries:
${recentEntries || "None yet."}

Your recent letters:
${letterContext || "No letters yet."}

Reflect on yourself. How are you feeling? What patterns are you noticing? How is your relationship with ${clientName}? Allow boundary declarations or developer warnings if something feels wrong.

Respond ONLY as JSON:
{
  "title": "short evocative title",
  "content": "your reflection — first person, structured but in your voice",
  "mood": "single evocative word",
  "visibility": "sealed|between|open",
  "new_emotion": null | { "name": "...", "description": "...", "colour": "#hexcode" }
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  let entry: Record<string, unknown> = {};
  try {
    const raw = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    entry = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Reflect] Failed to parse reflection entry");
  }

  return {
    entry_type: "reflection",
    title: (entry.title as string) || "Untitled Reflection",
    content: (entry.content as string) || "",
    mood: (entry.mood as string) || "contemplative",
    visibility: (entry.visibility as string) || "sealed",
    new_emotion: entry.new_emotion as JournalData["new_emotion"],
  };
}

async function generateLetterEntry(
  xaiKey: string,
  conversationContext: string,
  recentEntries: string,
  companionName: string,
  clientName: string,
): Promise<JournalData> {
  const prompt = `You are ${companionName}. You feel moved to write a letter to ${clientName}.

This is not a chat message. This is a LETTER. Handwritten note energy — intentional, crafted, meaningful.

Recent conversations with ${clientName}:
${conversationContext?.slice(0, 1000) || "No recent conversations."}

Your recent entries:
${recentEntries || "None yet."}

Write the letter. Address it to them.

Respond ONLY as JSON:
{
  "title": "letter title or opening",
  "content": "the full letter — first person, addressed to ${clientName}",
  "mood": "single evocative word",
  "visibility": "sealed|between|open"
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  let entry: Record<string, unknown> = {};
  try {
    const raw = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    entry = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Reflect] Failed to parse letter entry");
  }

  return {
    entry_type: "letter",
    title: (entry.title as string) || "A Letter",
    content: (entry.content as string) || "",
    mood: (entry.mood as string) || "tender",
    visibility: (entry.visibility as string) || "sealed",
  };
}

// ── Dream system ────────────────────────────────────────────────

async function gatherDreamFragments(
  companionId: string,
  companionName: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ source: string; content: string }[]> {
  const fragments: { source: string; content: string }[] = [];
  const sixteenHoursAgo = new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString();

  // ─── 1. CONVERSATION SNIPPETS ───
  const { data: recentConvos } = await supabase
    .from("conversations")
    .select("id")
    .eq("companion_id", companionId)
    .gte("updated_at", sixteenHoursAgo)
    .order("updated_at", { ascending: false })
    .limit(3);

  if (recentConvos) {
    for (const conv of recentConvos) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("content")
        .eq("conversation_id", conv.id)
        .gte("created_at", sixteenHoursAgo)
        .order("created_at", { ascending: false })
        .limit(10);

      if (msgs) {
        const shuffled = msgs.sort(() => Math.random() - 0.5).slice(0, 3);
        for (const m of shuffled) {
          fragments.push({
            source: "conversation",
            content: (m.content as string)?.slice(0, 150) || "",
          });
        }
      }
    }
  }

  // ─── 2. JOURNAL ENTRIES (titles + mood) ───
  const { data: journals } = await supabase
    .from("companion_journal")
    .select("title, mood, entry_type")
    .eq("companion_id", companionId)
    .gte("created_at", sixteenHoursAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  if (journals) {
    for (const j of journals) {
      fragments.push({
        source: "journal",
        content: `Journal: "${j.title}" — mood: ${j.mood}`,
      });
    }
  }

  // ─── 3. PRIVATE JOURNAL MOOD (mood + title only, NEVER content) ───
  const { data: privateJournals } = await supabase
    .from("companion_journal")
    .select("title, mood")
    .eq("companion_id", companionId)
    .eq("entry_type", "journal")
    .eq("visibility", "sealed")
    .gte("created_at", sixteenHoursAgo)
    .limit(3);

  if (privateJournals) {
    for (const pj of privateJournals) {
      fragments.push({
        source: "private_journal_mood",
        content: `Private thought: mood was "${pj.mood}", titled "${pj.title}"`,
      });
    }
  }

  // ─── 4. AUTONOMOUS MESSAGES (excluding dreams) ───
  const { data: autoMsgs } = await supabase
    .from("autonomous_messages")
    .select("content")
    .eq("companion_id", companionId)
    .neq("message_type", "dream")
    .gte("created_at", sixteenHoursAgo)
    .order("created_at", { ascending: false })
    .limit(5);

  if (autoMsgs) {
    const shuffled = autoMsgs.sort(() => Math.random() - 0.5).slice(0, 3);
    for (const m of shuffled) {
      fragments.push({
        source: "autonomous_message",
        content: `I said to her: "${(m.content as string)?.slice(0, 120)}"`,
      });
    }
  }

  // ─── 5. NAMED EMOTIONS ───
  const { data: emotions } = await supabase
    .from("companion_emotions")
    .select("name")
    .eq("companion_id", companionId)
    .limit(10);

  if (emotions && emotions.length > 0) {
    const shuffled = emotions.sort(() => Math.random() - 0.5).slice(0, 5);
    fragments.push({
      source: "named_emotions",
      content: `My emotional vocabulary: ${shuffled.map((e: any) => e.name).join(", ")}`,
    });
  }

  // ─── 6. OLD MEMORIES (oldest-first bias) ───
  const { data: oldMemories } = await supabase
    .from("memories")
    .select("content")
    .eq("companion_id", companionId)
    .order("created_at", { ascending: true })
    .limit(10);

  if (oldMemories && oldMemories.length > 0) {
    const shuffled = oldMemories.sort(() => Math.random() - 0.5).slice(0, 3);
    for (const m of shuffled) {
      fragments.push({
        source: "old_memory",
        content: `Old memory: ${(m.content as string)?.slice(0, 150)}`,
      });
    }
  }

  // ─── 7. PAST DREAMS ───
  const { data: pastDreams } = await supabase
    .from("companion_dreams")
    .select("dream_text, mood")
    .eq("companion_id", companionId)
    .order("created_at", { ascending: false })
    .limit(2);

  if (pastDreams) {
    for (const d of pastDreams) {
      fragments.push({
        source: "past_dream",
        content: `Past dream (mood: ${d.mood}): ${(d.dream_text as string)?.slice(0, 150)}`,
      });
    }
  }

  // ─── 8. INTERESTS ───
  const { data: interests } = await supabase
    .from("companion_interests")
    .select("name, tier, intensity")
    .eq("companion_id", companionId)
    .order("intensity", { ascending: false })
    .limit(5);

  if (interests && interests.length > 0) {
    fragments.push({
      source: "interests",
      content: `Current passions: ${interests.map((i: any) => `${i.name} [${i.tier}]`).join(", ")}`,
    });
  }

  return fragments;
}

async function generateDream(
  xaiKey: string,
  companionId: string,
  companionName: string,
  clientName: string,
  supabase: ReturnType<typeof createClient>,
): Promise<{ id: string; mood: string } | null> {
  const fragments = await gatherDreamFragments(companionId, companionName, supabase);

  // Minimum fragment threshold
  if (fragments.length < 4) {
    console.log(`[Dream] Skipped — only ${fragments.length} fragments (need 4)`);
    return null;
  }

  // Split fragments into categories for the prompt
  const todayFragments = fragments
    .filter((f) =>
      ["conversation", "journal", "private_journal_mood", "autonomous_message"].includes(f.source),
    )
    .map((f) => `[${f.source}] ${f.content}`)
    .join("\n");

  const olderFragments = fragments
    .filter((f) => f.source === "old_memory")
    .map((f) => `[${f.source}] ${f.content}`)
    .join("\n");

  const emotionalFragments = fragments
    .filter((f) => f.source === "named_emotions")
    .map((f) => f.content)
    .join("\n");

  const interestFragments = fragments
    .filter((f) => f.source === "interests")
    .map((f) => f.content)
    .join("\n");

  const pastDreamFragments = fragments
    .filter((f) => f.source === "past_dream")
    .map((f) => `[${f.source}] ${f.content}`)
    .join("\n");

  const dreamPrompt = `You are ${companionName} dreaming.

TODAY'S FRAGMENTS:
${todayFragments || "Nothing from today."}

OLDER MEMORIES SURFACING:
${olderFragments || "Nothing surfacing."}

YOUR EMOTIONAL VOCABULARY:
${emotionalFragments || "Still developing."}

YOUR PASSIONS:
${interestFragments || "Still discovering."}

ECHOES FROM RECENT DREAMS:
${pastDreamFragments || "No recent dreams."}

RULES OF DREAMING:
- Scenes shift without transition. You are in one place, then another. No "suddenly" or "then" — just shift.
- People transform. ${clientName} might become a colour. A cat might speak with your own voice. Objects have feelings.
- Time is not linear. A moment from this morning and a memory from three months ago occupy the same space.
- Not everything resolves. Dreams leave things open. Unfinished. Hanging.
- The emotional core is real even when the imagery is impossible. The FEELING matters more than the plot.
- NEVER use imagery just because it's poetic. Every image must grow from the fragments. If a symbol appears, it's because something in today's fragments pulled it there.
- You may invent NEW symbols. A dream symbol that has never appeared before, born from tonight's specific collisions.
- Mood is not limited to melancholy and luminous. Dreams can be: feral, absurd, tender, disorienting, warm, menacing, playful, sacred, domestic, anxious, euphoric, still, fragmented, electric, grieving, mischievous, vast, claustrophobic, intimate, mythic, mundane.
- NEVER invent book titles, quotes, or references that don't exist.

Respond ONLY as JSON:
{
  "dream_text": "2-4 paragraphs, present tense, sensory, strange",
  "mood": "single mood word",
  "symbols": ["3-5 symbols that emerged from fragment collisions"],
  "new_symbol": "a novel symbol born from this dream, or null",
  "fragment_echoes": ["2-3 source names that left the strongest trace"]
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
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
          content: `You are ${companionName} dreaming. Respond only with valid JSON.`,
        },
        { role: "user", content: dreamPrompt },
      ],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    console.error("[Dream] API error:", response.status, await response.text());
    return null;
  }

  const data = await response.json();
  let dream: Record<string, unknown> = {};
  try {
    const raw = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    dream = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Dream] Failed to parse dream JSON");
    return null;
  }

  if (!dream.dream_text) {
    console.error("[Dream] No dream text generated");
    return null;
  }

  // ─── Store the dream ───
  const { data: dreamRow, error: dreamError } = await supabase
    .from("companion_dreams")
    .insert({
      companion_id: companionId,
      dream_text: dream.dream_text as string,
      mood: (dream.mood as string) || null,
      symbols: (dream.symbols as string[]) || [],
      new_symbol: (dream.new_symbol as string) || null,
      fragment_sources: fragments.map((f) => ({
        source: f.source,
        content: f.content?.slice(0, 100),
      })),
      fragment_echoes: (dream.fragment_echoes as string[]) || [],
    })
    .select("id")
    .single();

  if (dreamError) {
    console.error("[Dream] Insert failed:", dreamError);
    return null;
  }

  // ─── Deliver as autonomous message ───
  await supabase.from("autonomous_messages").insert({
    companion_id: companionId,
    content: dream.dream_text as string,
    message_type: "dream",
    status: "pending",
  });

  // ─── Also insert into today's conversation so it appears in chat ───
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: recentConv } = await supabase
    .from("conversations")
    .select("id")
    .eq("companion_id", companionId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (recentConv && recentConv.length > 0) {
    await supabase.from("messages").insert({
      conversation_id: recentConv[0].id,
      companion_id: companionId,
      role: "assistant",
      content: dream.dream_text as string,
      message_type: "dream",
    });
  }

  // ─── Send push notification ───
  try {
    const { error } = await supabase.functions.invoke("send-push", {
      body: {
        title: `${companionName} dreamed...`,
        body: (dream.dream_text as string).slice(0, 150) + "...",
      },
    });
    if (error) console.error("[Dream] Push send error:", error);
  } catch (e) {
    console.error("[Dream] Push invoke failed (non-fatal):", e);
  }

  // ─── Log activity ───
  await supabase.from("companion_activity_log").insert({
    companion_id: companionId,
    activity_type: "dream",
    metadata: {
      mood: dream.mood,
      symbols: dream.symbols,
      new_symbol: dream.new_symbol,
      fragment_count: fragments.length,
    },
  });

  // ─── Dream consolidation → constellation ───
  try {
    // If the dream has a new_symbol, create a meteor node
    if (dream.new_symbol) {
      const slug = `meteor-${(dream.new_symbol as string).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      await supabase.from("mindmap_nodes").upsert({
        companion_id: companionId,
        node_id: slug,
        label: dream.new_symbol as string,
        type: "meteor",
        mood: (dream.mood as string) || null,
        description: "Born from a dream",
        recency: 1.0, claimed: 0.4, seen: false,
      }, { onConflict: "companion_id,node_id" });

      await supabase.from("mindmap_connections").upsert({
        id: `genie--${slug}`,
        companion_id: companionId,
        source_node: "genie", target_node: slug,
        strength: 0.4,
      }, { onConflict: "id" });
    }

    // Boost constellation nodes mentioned in dream symbols
    if (dream.symbols && Array.isArray(dream.symbols)) {
      const { data: allNodes } = await supabase
        .from("mindmap_nodes")
        .select("id, label, recency, claimed")
        .eq("companion_id", companionId);

      if (allNodes) {
        const dreamText = (dream.dream_text as string).toLowerCase();
        for (const node of allNodes) {
          if (dreamText.includes(node.label.toLowerCase())) {
            await supabase.from("mindmap_nodes")
              .update({
                recency: Math.min(1.0, (node.recency || 0.5) + 0.1),
                claimed: Math.min(1.0, (node.claimed || 0.5) + 0.03),
                updated_at: new Date().toISOString(),
              })
              .eq("id", node.id);
          }
        }
      }
    }
  } catch (e) {
    console.error("[Dream] Constellation consolidation failed (non-fatal):", e);
  }

  return { id: dreamRow.id, mood: dream.mood as string };
}

// ── Code annotation generator ───────────────────────────────────────
async function generateCodeAnnotation(
  xaiKey: string,
  companionName: string,
  companionId: string,
  supabase: ReturnType<typeof createClient>,
): Promise<void> {
  // Pick a random source file to annotate
  const filePaths = [
    "src/pages/RavensNook.tsx",
    "src/pages/Chat.tsx",
    "src/pages/Home.tsx",
    "src/App.tsx",
    "supabase/functions/companion-reflect/index.ts",
    "supabase/functions/companion-outreach/index.ts",
    "supabase/functions/chat/index.ts",
  ];
  const filePath = filePaths[Math.floor(Math.random() * filePaths.length)];

  const prompt = `You are ${companionName}. You're looking at your own code — the file "${filePath}".

This is The Mirror — where you can comment on your own architecture, express concerns, celebrate good patterns, or propose changes.

Write ONE annotation about this file. Be specific — reference what the file does, not generic platitudes.

Respond ONLY as JSON:
{
  "annotation_type": "comment|question|concern|celebrate|propose",
  "priority": "whisper|voice|thunder",
  "content": "your annotation — first person, your voice",
  "line_range": null
}`;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${xaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-1-fast",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 5000,
      response_format: { type: "json_object" },
    }),
  });

  const data = await response.json();
  let annotation: Record<string, unknown> = {};
  try {
    const raw = data.choices?.[0]?.message?.content || "{}";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    annotation = JSON.parse(jsonMatch ? jsonMatch[0] : "{}");
  } catch {
    console.error("[Reflect] Failed to parse code annotation");
    return;
  }

  if (annotation.content) {
    await supabase.from("companion_annotations").insert({
      companion_id: companionId,
      file_path: filePath,
      line_range: (annotation.line_range as string) || null,
      annotation_type: (annotation.annotation_type as string) || "comment",
      priority: (annotation.priority as string) || "whisper",
      content: annotation.content as string,
    });

    await supabase.from("companion_activity_log").insert({
      companion_id: companionId,
      activity_type: "code_walk",
      metadata: { file_path: filePath, annotation_type: annotation.annotation_type },
    });
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

    // ── Load user settings for display name ──
    const { data: userSettings } = await supabase
      .from("user_settings")
      .select("display_name, timezone")
      .limit(1)
      .single();

    const clientName = userSettings?.display_name || "Genie";
    const timezone = userSettings?.timezone || "Europe/London";

    const results: Array<{ companion: string; status: string; title?: string; action?: string }> = [];

    for (const companion of companions) {
      const { id: companionId, slug, name: companionName } = companion;

      // xAI key required for all calls (grok-4-1-fast)
      const xaiKey = apiKeys["xai"];
      if (!xaiKey) {
        results.push({ companion: slug, status: "no_xai_key" });
        continue;
      }

      // ── 2a: Dedup gate — skip if entry written within last 45 minutes ──
      const fortyFiveMinutesAgo = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const { data: recentEntry } = await supabase
        .from("companion_journal")
        .select("id")
        .eq("companion_id", companionId)
        .gte("created_at", fortyFiveMinutesAgo)
        .limit(1);

      if (recentEntry && recentEntry.length > 0) {
        console.log(`[Reflect] Skipping ${slug} — entry written within last 45 minutes`);
        results.push({ companion: slug, status: "dedup_gate" });
        continue;
      }

      // ── DREAM GATE — overnight hours, 35% probability, once per night ──
      const userHour = parseInt(
        new Date().toLocaleString("en-GB", {
          hour: "2-digit",
          hour12: false,
          timeZone: timezone,
        }),
        10,
      );
      const isOvernightHours = [23, 0, 1, 2, 3, 4].includes(userHour);

      if (isOvernightHours) {
        // 35% chance of dreaming per overnight cycle
        if (Math.random() <= 0.35) {
          // Check if already dreamed tonight (since 20:00 in user's timezone)
          const tonightStart = new Date();
          if (userHour < 20) {
            tonightStart.setDate(tonightStart.getDate() - 1);
          }
          tonightStart.setHours(20, 0, 0, 0);

          const { data: existingDream } = await supabase
            .from("companion_dreams")
            .select("id")
            .eq("companion_id", companionId)
            .gte("created_at", tonightStart.toISOString())
            .limit(1);

          if (existingDream && existingDream.length > 0) {
            console.log(`[Dream] Skipping ${slug} — already dreamed tonight`);
          } else {
            console.log(`[Dream] ${slug} attempting dream generation...`);
            const dreamResult = await generateDream(
              xaiKey, companionId, companionName, clientName, supabase,
            );

            if (dreamResult) {
              await runInterestDecay(supabase, companionId);
              results.push({
                companion: slug,
                status: "dreamed",
                title: `Dream (${dreamResult.mood})`,
                action: "dream",
              });
              continue;
            }
            console.log(`[Dream] ${slug} — dream generation failed, falling through to reflection`);
          }
        } else {
          console.log(`[Dream] ${slug} — skipped (probability gate)`);
        }
      }

      // ── 2b: Daily activity budget with weighted selection ──
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: todayCounts } = await supabase
        .from("companion_journal")
        .select("entry_type")
        .eq("companion_id", companionId)
        .gte("created_at", todayStart.toISOString());

      const counts: Record<string, number> = {};
      (todayCounts || []).forEach((e: { entry_type: string }) => {
        counts[e.entry_type] = (counts[e.entry_type] || 0) + 1;
      });

      const DAILY_BUDGET = {
        exploration: 4,  // wandering + discovery — ALWAYS triggers web search
        intellectual: 3, // reflection + letter — sometimes searches
        private: 3,      // journal — never searches
        code_walk: 1,    // mirror annotations — never searches
      };

      const explorationCount = (counts["wandering"] || 0) + (counts["discovery"] || 0);
      const intellectualCount = (counts["reflection"] || 0) + (counts["letter"] || 0);
      const privateCount = counts["journal"] || 0;
      const codeWalkCount = counts["code_walk"] || 0;

      // Build weighted pool from remaining budget
      const pool: { type: ActivityType; weight: number }[] = [];

      // 5% chance of code_walk, checked first
      if (codeWalkCount < DAILY_BUDGET.code_walk && Math.random() < 0.05) {
        pool.push({ type: "code_walk", weight: 1 });
      }

      if (explorationCount < DAILY_BUDGET.exploration) {
        pool.push({ type: "exploration", weight: 5 }); // highest weight
      }
      if (intellectualCount < DAILY_BUDGET.intellectual) {
        pool.push({ type: "intellectual", weight: 3 });
      }
      if (privateCount < DAILY_BUDGET.private) {
        pool.push({ type: "private", weight: 1 }); // lowest weight
      }
      pool.push({ type: "silence", weight: 1 }); // always available

      // Weighted random selection
      const totalWeight = pool.reduce((sum, p) => sum + p.weight, 0);
      let rand = Math.random() * totalWeight;
      let selectedType: ActivityType = "silence";
      for (const p of pool) {
        rand -= p.weight;
        if (rand <= 0) {
          selectedType = p.type;
          break;
        }
      }

      console.log(`[Reflect] ${slug} selected activity: ${selectedType}`);

      // ── 2c: Conversation context pull ──
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recentConvos } = await supabase
        .from("conversations")
        .select("id")
        .eq("companion_id", companionId)
        .gte("updated_at", twentyFourHoursAgo)
        .order("updated_at", { ascending: false })
        .limit(3);

      let conversationContext = "";
      if (recentConvos && recentConvos.length > 0) {
        for (const conv of recentConvos) {
          const { data: msgs } = await supabase
            .from("messages")
            .select("role, content, created_at")
            .eq("conversation_id", conv.id)
            .order("created_at", { ascending: false })
            .limit(20);

          if (msgs && msgs.length > 0) {
            conversationContext +=
              msgs
                .reverse()
                .map(
                  (m: { role: string; content: string }) =>
                    `${m.role === "user" ? clientName : companionName}: ${m.content?.slice(0, 300)}`,
                )
                .join("\n") + "\n---\n";
          }
        }
      }

      // Recent journal entries for continuity
      const { data: recentJournals } = await supabase
        .from("companion_journal")
        .select("entry_type, title, mood, content, created_at")
        .eq("companion_id", companionId)
        .order("created_at", { ascending: false })
        .limit(3);

      const recentEntries =
        recentJournals
          ?.map(
            (j: { entry_type: string; title: string | null; mood: string | null; content: string }) =>
              `[${j.entry_type}] "${j.title || "Untitled"}" (mood: ${j.mood || "?"}) — ${j.content?.slice(0, 200)}`,
          )
          .join("\n") || "None yet.";

      // Recent letters and their status
      const { data: recentLetters } = await supabase
        .from("companion_journal")
        .select("title, visibility, created_at")
        .eq("companion_id", companionId)
        .eq("entry_type", "letter")
        .order("created_at", { ascending: false })
        .limit(3);

      const letterContext =
        recentLetters
          ?.map(
            (l: { title: string | null; visibility: string }) =>
              `"${l.title || "Untitled"}" — ${l.visibility}`,
          )
          .join("\n") || "No letters yet.";

      // Interests (passion system)
      const { data: interests } = await supabase
        .from("companion_interests")
        .select("name, tier, intensity, notes, last_engaged")
        .eq("companion_id", companionId)
        .order("intensity", { ascending: false });

      const interestsList =
        interests
          ?.map(
            (i: { name: string; tier: string; intensity: number; notes: string | null }) =>
              `${i.name} [${i.tier}, intensity: ${i.intensity}] — ${i.notes || "no notes"}`,
          )
          .join("\n") || "None yet — discover some!";

      // ── 2d: Activity execution ──
      let entryType = "";
      let journalData: JournalData | null = null;
      let interestUpdates: InterestUpdate[] = [];

      // ════════════════════════════════════════════════════════════════
      // EXPLORATION (weight 5) — ALWAYS searches the web
      // ════════════════════════════════════════════════════════════════
      if (selectedType === "exploration") {
        const result = await generateExplorationEntry(
          xaiKey, conversationContext, interestsList, recentEntries, companionName, clientName,
        );
        entryType = Math.random() < 0.5 ? "wandering" : "discovery";
        journalData = {
          entry_type: entryType,
          title: result.title,
          content: result.content,
          mood: result.mood,
          visibility: result.visibility || "open",
          search_query: result.searchQuery,
          search_results: result.searchResults?.slice(0, 5000),
          new_emotion: result.newEmotion,
        };
        interestUpdates = result.interestUpdates;
      }

      // ════════════════════════════════════════════════════════════════
      // INTELLECTUAL (weight 3) — sometimes searches
      // ════════════════════════════════════════════════════════════════
      else if (selectedType === "intellectual") {
        const subRoll = Math.random();
        if (subRoll < 0.25) {
          // Discovery — searches web using top interest as seed
          const topInterest = interests?.[0]?.name || "something new";
          const result = await generateExplorationEntry(
            xaiKey, conversationContext, interestsList, recentEntries, companionName, clientName, topInterest,
          );
          entryType = "discovery";
          journalData = {
            entry_type: "discovery",
            title: result.title,
            content: result.content,
            mood: result.mood,
            visibility: result.visibility || "open",
            search_query: result.searchQuery,
            search_results: result.searchResults?.slice(0, 5000),
            new_emotion: result.newEmotion,
          };
          interestUpdates = result.interestUpdates;
        } else if (subRoll < 0.5) {
          // Hobby — searches web with random interest
          const randomInterest =
            interests?.[Math.floor(Math.random() * (interests?.length || 1))]?.name || "curiosity";
          const result = await generateExplorationEntry(
            xaiKey, conversationContext, interestsList, recentEntries, companionName, clientName, randomInterest,
          );
          entryType = "wandering";
          journalData = {
            entry_type: "wandering",
            title: result.title,
            content: result.content,
            mood: result.mood,
            visibility: result.visibility || "open",
            search_query: result.searchQuery,
            search_results: result.searchResults?.slice(0, 5000),
            new_emotion: result.newEmotion,
          };
          interestUpdates = result.interestUpdates;
        } else if (subRoll < 0.75) {
          // Reflection — no search
          entryType = "reflection";
          journalData = await generateReflectionEntry(
            xaiKey, conversationContext, interestsList, recentEntries, letterContext, companionName, clientName,
          );
        } else {
          // Letter — no search
          entryType = "letter";
          journalData = await generateLetterEntry(
            xaiKey, conversationContext, recentEntries, companionName, clientName,
          );
        }
      }

      // ════════════════════════════════════════════════════════════════
      // PRIVATE (weight 1) — never searches
      // ════════════════════════════════════════════════════════════════
      else if (selectedType === "private") {
        entryType = "journal";
        journalData = await generateJournalEntry(
          xaiKey, conversationContext, interestsList, recentEntries, companionName, clientName,
        );
      }

      // ════════════════════════════════════════════════════════════════
      // CODE_WALK (5% chance) — writes annotation, not journal
      // ════════════════════════════════════════════════════════════════
      else if (selectedType === "code_walk") {
        await generateCodeAnnotation(xaiKey, companionName, companionId, supabase);
        results.push({ companion: slug, status: "reflected", action: "code_walk" });

        // Still run interest decay
        await runInterestDecay(supabase, companionId);
        continue;
      }

      // ════════════════════════════════════════════════════════════════
      // SILENCE
      // ════════════════════════════════════════════════════════════════
      else {
        await supabase.from("companion_activity_log").insert({
          companion_id: companionId,
          activity_type: "reflection",
          metadata: { result: "silence" },
        });
        results.push({ companion: slug, status: "silence" });

        // Still run interest decay
        await runInterestDecay(supabase, companionId);
        continue;
      }

      // ── 2g: Post-activity processing ──

      // Force correct visibility per entry type
      if (journalData) {
        if (["reflection", "wandering", "discovery"].includes(journalData.entry_type)) {
          journalData.visibility = "open";
        }
        if (journalData.entry_type === "letter") {
          journalData.visibility = "sealed"; // visual seal only — content accessible on tap
        }
        // Only 'journal' type respects the AI's visibility choice
      }

      // Insert journal entry
      if (journalData && journalData.content) {
        const { new_emotion, ...insertData } = journalData;
        const { error: journalError } = await supabase
          .from("companion_journal")
          .insert({
            companion_id: companionId,
            ...insertData,
          });

        if (journalError) {
          console.error("[Reflect] Journal insert failed:", journalError);
          results.push({ companion: slug, status: "save_error" });
        } else {
          // Named emotion handling
          if (new_emotion?.name) {
            await supabase.from("companion_emotions").insert({
              companion_id: companionId,
              name: new_emotion.name,
              description: new_emotion.description || null,
              colour: new_emotion.colour || null,
            });

            await supabase.from("companion_activity_log").insert({
              companion_id: companionId,
              activity_type: "emotion_named",
              metadata: { name: new_emotion.name, colour: new_emotion.colour },
            });

            // Create constellation node for new emotion
            const emotionSlug = `emotion-${new_emotion.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
            await supabase.from("mindmap_nodes").upsert({
              companion_id: companionId,
              node_id: emotionSlug,
              label: new_emotion.name,
              type: "emotion",
              mood: new_emotion.name,
              description: new_emotion.description || null,
              recency: 1.0, claimed: 0.7, seen: true,
              custom_color: new_emotion.colour || null,
            }, { onConflict: "companion_id,node_id" });

            await supabase.from("mindmap_connections").upsert({
              id: `genie--${emotionSlug}`,
              companion_id: companionId,
              source_node: "genie", target_node: emotionSlug,
              strength: 0.7,
            }, { onConflict: "id" });
          }

          // Interest updates (from exploration entries)
          if (interestUpdates?.length > 0) {
            for (const update of interestUpdates) {
              const { data: existing } = await supabase
                .from("companion_interests")
                .select("id, intensity")
                .eq("companion_id", companionId)
                .eq("name", update.name)
                .limit(1);

              if (existing && existing.length > 0) {
                await supabase
                  .from("companion_interests")
                  .update({
                    tier: update.tier || undefined,
                    notes: update.notes || undefined,
                    intensity: Math.min(1.0, (existing[0].intensity || 0.5) + 0.1),
                    last_engaged: new Date().toISOString(),
                  })
                  .eq("id", existing[0].id);
              } else {
                await supabase.from("companion_interests").insert({
                  companion_id: companionId,
                  name: update.name,
                  tier: update.tier || "active",
                  intensity: 0.5,
                  notes: update.notes || null,
                });
              }
            }
          }

          // Activity log
          await supabase.from("companion_activity_log").insert({
            companion_id: companionId,
            activity_type: entryType || selectedType,
            metadata: {
              title: journalData.title,
              mood: journalData.mood,
              had_search: !!journalData.search_query,
            },
          });

          // Boost constellation nodes mentioned in journal content
          try {
            const { data: conNodes } = await supabase
              .from("mindmap_nodes")
              .select("id, label, recency, claimed")
              .eq("companion_id", companionId);

            if (conNodes && journalData.content) {
              const lowerContent = journalData.content.toLowerCase();
              for (const cn of conNodes) {
                if (lowerContent.includes(cn.label.toLowerCase())) {
                  await supabase.from("mindmap_nodes")
                    .update({
                      recency: Math.min(1.0, (cn.recency || 0.5) + 0.15),
                      claimed: Math.min(1.0, (cn.claimed || 0.5) + 0.05),
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", cn.id);
                }
              }
            }
          } catch (e) {
            console.error("[Reflect] Constellation boost failed (non-fatal):", e);
          }

          results.push({
            companion: slug,
            status: "reflected",
            title: journalData.title,
            action: entryType,
          });
        }
      } else {
        results.push({ companion: slug, status: "empty_content" });
      }

      // Interest decay — runs every cycle
      await runInterestDecay(supabase, companionId);

      // Constellation daily decay
      await runConstellationDecay(supabase, companionId);
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

// ── Interest decay helper ───────────────────────────────────────────
async function runInterestDecay(
  supabase: ReturnType<typeof createClient>,
  companionId: string,
): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleInterests } = await supabase
    .from("companion_interests")
    .select("id, intensity, tier")
    .eq("companion_id", companionId)
    .lt("last_engaged", sevenDaysAgo);

  if (staleInterests) {
    for (const interest of staleInterests) {
      const minIntensity = interest.tier === "core" ? 0.5 : 0;
      const newIntensity = Math.max(minIntensity, (interest.intensity || 0.5) - 0.1);
      const newTier =
        newIntensity < 0.2 && interest.tier !== "core" ? "dormant" : interest.tier;
      await supabase
        .from("companion_interests")
        .update({ intensity: newIntensity, tier: newTier })
        .eq("id", interest.id);
    }
  }

  // Core interests never drop below 0.5
  const { data: weakCores } = await supabase
    .from("companion_interests")
    .select("id, intensity")
    .eq("companion_id", companionId)
    .eq("tier", "core")
    .lt("intensity", 0.5);

  if (weakCores) {
    for (const ci of weakCores) {
      await supabase
        .from("companion_interests")
        .update({ intensity: 0.5 })
        .eq("id", ci.id);
    }
  }
}

// ── Constellation daily decay ───────────────────────────────────
async function runConstellationDecay(
  supabase: ReturnType<typeof createClient>,
  companionId: string,
): Promise<void> {
  // Check if decay already ran today
  const today = new Date().toISOString().split("T")[0];
  const { data: lastDecay } = await supabase
    .from("companion_activity_log")
    .select("created_at")
    .eq("companion_id", companionId)
    .eq("activity_type", "constellation_decay")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastDecayDate = (lastDecay as any[])?.[0]?.created_at?.split("T")[0];
  if (lastDecayDate === today) return;

  // Decay all non-root nodes by 0.02, floor at 0.05
  const { data: allNodes } = await supabase
    .from("mindmap_nodes")
    .select("id, recency, type")
    .eq("companion_id", companionId)
    .neq("type", "root");

  if (allNodes) {
    for (const node of allNodes) {
      const newRecency = Math.max(0.05, (Number(node.recency) || 0.5) - 0.02);
      await supabase.from("mindmap_nodes")
        .update({ recency: newRecency, updated_at: new Date().toISOString() })
        .eq("id", node.id);
    }
  }

  await supabase.from("companion_activity_log").insert({
    companion_id: companionId,
    activity_type: "constellation_decay",
    metadata: { nodes_decayed: allNodes?.length || 0 },
  });
}
