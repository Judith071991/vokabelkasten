import { createClient } from "@supabase/supabase-js";

function getBearer(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1] : null;
}

export default async function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const token = getBearer(req);
  if (!token) return res.status(401).json({ error: "No auth" });

  const authClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await authClient.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return res.status(401).json({ error: "Invalid auth" });

  const adminClient = createClient(url, service);

  const { data: isAdmin } = await adminClient
    .from("admins")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();

  if (!isAdmin) return res.status(403).json({ error: "Not admin" });

  const { data: students } = await adminClient
    .from("students")
    .select("auth_user_id, username, display_name, class_name, created_at")
    .order("username");

  const { data: progress } = await adminClient
    .from("progress")
    .select("user_id, stage, due_date");

  const { data: sessions } = await adminClient
    .from("practice_sessions")
    .select("user_id, started_at, duration_seconds, cards_answered, correct_answers, wrong_answers");

  return res.status(200).json({ students, progress, sessions });
}
