// Lets an admin set another employee's password directly, without ever
// exposing the Supabase service_role key to the browser.
//
// The browser calls this function with the ADMIN's own access token. This
// function verifies that token belongs to a real user who is listed in the
// `admins` table, and only then uses the service_role key (which lives only
// here, as a built-in Supabase Edge Function secret) to update the target
// employee's password.
//
// Deploy with the Supabase CLI from the repo root:
//   supabase functions deploy admin-set-password
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically by
// Supabase for every Edge Function, no manual secret setup needed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing auth token" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Who is calling?
    const { data: { user: caller }, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller) return json({ error: "Invalid session" }, 401);

    // Are they actually an admin?
    const { data: adminRow } = await admin
      .from("admins")
      .select("user_id")
      .eq("user_id", caller.id)
      .maybeSingle();
    if (!adminRow) return json({ error: "Not authorized" }, 403);

    const { email, newPassword } = await req.json();
    if (!email || typeof newPassword !== "string" || newPassword.length < 6) {
      return json({ error: "Email and a password of at least 6 characters are required" }, 400);
    }

    // Find the target user by email (small team, so paging isn't a concern).
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) return json({ error: listErr.message }, 500);
    const target = list.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    if (!target) return json({ error: "No account found for that email" }, 404);

    const { error: updateErr } = await admin.auth.admin.updateUserById(target.id, { password: newPassword });
    if (updateErr) return json({ error: updateErr.message }, 500);

    return json({ success: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
