import { createClient } from "@supabase/supabase-js";

function ymd(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function handler(req, res) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return res.status(500).json({ error: "Server-Konfiguration fehlt (Supabase Keys)." });
    }

    // Admin-Client (Service Role) – nur serverseitig!
    const supabaseAdmin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Kein Token." });

    // Token prüfen + User holen
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return res.status(401).json({ error: "Token ungültig." });

    const adminUserId = userData.user.id;

    // Ist der User Admin?
    const { data: adminRow, error: adminCheckErr } = await supabaseAdmin
      .from("admins")
      .select("user_id")
      .eq("user_id", adminUserId)
      .maybeSingle();

    if (adminCheckErr) return res.status(500).json({ error: "Admin-Check fehlgeschlagen." });
    if (!adminRow) return res.status(403).json({ error: "Kein Admin-Zugriff." });

    // Students holen
    const { data: students, error: stuErr } = await supabaseAdmin
      .from("students")
      .select("id, auth_user_id, username, display_name, class_name")
      .order("username", { ascending: true });

    if (stuErr) return res.status(500).json({ error: "Students konnten nicht geladen werden." });

    const today = new Date();
    const todayStr = ymd(today);

    const since30 = new Date(today);
    since30.setDate(since30.getDate() - 30);
    const since30ISO = since30.toISOString();

    const since7 = new Date(today);
    since7.setDate(since7.getDate() - 7);
    const since7ISO = since7.toISOString();

    const result = [];

    for (const s of students || []) {
      // Progress (Stage-Verteilung + fällig)
      const { data: progRows, error: progErr } = await supabaseAdmin
        .from("progress")
        .select("stage, due_date")
        .eq("user_id", s.auth_user_id);

      if (progErr) {
        result.push({
          student: s,
          error: "progress_error",
        });
        continue;
      }

      const stageCounts = [0, 0, 0, 0, 0];
      let dueNow = 0;

      for (const p of progRows || []) {
        const st = typeof p.stage === "number" ? p.stage : 0;
        if (st >= 0 && st <= 4) stageCounts[st] += 1;

        if (p.due_date && String(p.due_date) <= todayStr) dueNow += 1;
      }

      const totalCards = stageCounts.reduce((a, b) => a + b, 0);
      const mastered = stageCounts[4];

      // Practice Sessions (letzte 30 Tage) → pro Tag aggregieren
      const { data: sessRows, error: sessErr } = await supabaseAdmin
        .from("practice_sessions")
        .select("started_at, ended_at, duration_seconds, cards_answered, correct_answers, wrong_answers, last_activity_at")
        .eq("user_id", s.auth_user_id)
        .gte("started_at", since30ISO)
        .order("started_at", { ascending: false });

      if (sessErr) {
        result.push({
          student: s,
          totalCards,
          stageCounts,
          dueNow,
          mastered,
          activity: { days: [], lastPracticeAt: null, minutes7d: 0, daysPracticed7d: 0 },
        });
        continue;
      }

      // Tages-Aggregation
      const dayMap = new Map(); // ymd -> {date, seconds, cards, correct, wrong}
      let lastPracticeAt = null;

      for (const r of sessRows || []) {
        const key = ymd(r.started_at || r.last_activity_at || new Date().toISOString());
        const prev = dayMap.get(key) || {
          date: key,
          seconds: 0,
          cards: 0,
          correct: 0,
          wrong: 0,
        };

        prev.seconds += Number(r.duration_seconds || 0);
        prev.cards += Number(r.cards_answered || 0);
        prev.correct += Number(r.correct_answers || 0);
        prev.wrong += Number(r.wrong_answers || 0);

        dayMap.set(key, prev);

        if (!lastPracticeAt) {
          lastPracticeAt = r.last_activity_at || r.ended_at || r.started_at || null;
        }
      }

      const days = Array.from(dayMap.values()).sort((a, b) => (a.date < b.date ? 1 : -1));

      // 7 Tage Summe
      let seconds7d = 0;
      const practiced7dSet = new Set();
      for (const r of sessRows || []) {
        const sa = r.started_at || r.last_activity_at;
        if (!sa) continue;
        if (new Date(sa).toISOString() >= since7ISO) {
          seconds7d += Number(r.duration_seconds || 0);
          practiced7dSet.add(ymd(sa));
        }
      }

      result.push({
        student: s,
        totalCards,
        stageCounts,
        dueNow,
        mastered,
        activity: {
          days, // letzte 30 Tage (aggregiert)
          lastPracticeAt,
          minutes7d: Math.round(seconds7d / 60),
          daysPracticed7d: practiced7dSet.size,
        },
      });
    }

    return res.status(200).json({ today: todayStr, students: result });
  } catch (e) {
    return res.status(500).json({ error: "Serverfehler." });
  }
}
