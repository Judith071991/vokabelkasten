import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { todayYMD } from "../lib/srs";
import { useRouter } from "next/router";

export default function Admin() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [data, setData] = useState(null);
  const today = todayYMD();

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return router.push("/");
      const token = sess.session.access_token;

      const r = await fetch("/api/admin/summary", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = await r.json();
      if (!r.ok) {
        setMsg(j?.error || "Kein Admin-Zugriff.");
        return;
      }
      setData(j);
    })();
  }, [router]);

  const computed = useMemo(() => {
    if (!data) return null;

    const stageMap = new Map();
    const dueMap = new Map();
    for (const p of data.progress || []) {
      const arr = stageMap.get(p.user_id) || [0, 0, 0, 0, 0];
      arr[p.stage] = (arr[p.stage] || 0) + 1;
      stageMap.set(p.user_id, arr);
      if (p.due_date <= today) dueMap.set(p.user_id, (dueMap.get(p.user_id) || 0) + 1);
    }

    const mins7Map = new Map();
    const now = new Date();
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 7);

    for (const s of data.sessions || []) {
      const started = new Date(s.started_at);
      if (started >= weekAgo) {
        const mins = Math.round((s.duration_seconds || 0) / 60);
        mins7Map.set(s.user_id, (mins7Map.get(s.user_id) || 0) + mins);
      }
    }

    return { stageMap, dueMap, mins7Map };
  }, [data, today]);

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>Admin</h1>
      <p style={{ color: "#666" }}>Übungszeiten + Stufenübersicht</p>

      {msg && <p style={{ color: "#b00" }}>{msg}</p>}
      {!data && !msg && <p>Lade…</p>}

      {data && computed && (
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: 8 }}>Username</th>
                <th style={{ padding: 8 }}>Klasse</th>
                <th style={{ padding: 8 }}>Heute fällig</th>
                <th style={{ padding: 8 }}>Minuten (7 Tage)</th>
                <th style={{ padding: 8 }}>Stages (0–4)</th>
              </tr>
            </thead>
            <tbody>
              {(data.students || []).map((s) => {
                const stages = computed.stageMap.get(s.auth_user_id) || [0, 0, 0, 0, 0];
                const due = computed.dueMap.get(s.auth_user_id) || 0;
                const mins7 = computed.mins7Map.get(s.auth_user_id) || 0;

                return (
                  <tr key={s.auth_user_id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8, fontWeight: 700 }}>{s.username}</td>
                    <td style={{ padding: 8 }}>{s.class_name || "-"}</td>
                    <td style={{ padding: 8 }}>{due}</td>
                    <td style={{ padding: 8 }}>{mins7}</td>
                    <td style={{ padding: 8 }}>{stages.join(" / ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
            Minuten = Summe aus Trainings-Sessions (Start bis Ende).
          </p>
        </div>
      )}
    </main>
  );
}
