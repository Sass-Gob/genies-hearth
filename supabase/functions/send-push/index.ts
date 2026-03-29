import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

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
    const { title, body, url } = await req.json();

    if (!title || !body) {
      return new Response(
        JSON.stringify({ error: "title and body required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: "VAPID keys not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    webpush.setVapidDetails(
      "mailto:genieshearth@example.com",
      vapidPublicKey,
      vapidPrivateKey,
    );

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Load all push subscriptions
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, keys");

    if (!subs || subs.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "no_subscriptions" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const payload = JSON.stringify({
      title,
      body: body.slice(0, 200),
      url: url || "/",
      icon: "/icon-192.png",
    });

    let sent = 0;
    const errors: string[] = [];

    for (const sub of subs) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: sub.keys,
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (err: unknown) {
        const pushErr = err as { statusCode?: number; message?: string };
        console.error(`Push failed for ${sub.endpoint.slice(0, 50)}:`, pushErr.statusCode, pushErr.message);

        // Remove expired/invalid subscriptions
        if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
          console.log(`Removed expired subscription: ${sub.id}`);
        }

        errors.push(`${pushErr.statusCode || "unknown"}: ${pushErr.message?.slice(0, 100) || "unknown"}`);
      }
    }

    return new Response(
      JSON.stringify({ sent, total: subs.length, errors: errors.length > 0 ? errors : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("Send-push error:", errMsg);
    return new Response(
      JSON.stringify({ error: "internal_error", debug: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
