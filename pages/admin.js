import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function Admin() {
  const router = useRouter();
  const [msg, setMsg] = useState("Lade…");
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) return router.push("/");

      const token = sess.session.access_token;

      const r = await fetch("/api/admin/overview", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await r.json();
      if (!r.ok) {
        setMsg(j?.error || "Kein Zugriff / Fehler.");
        return;
      }

      setData(j);
      setMsg("");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    const all = data?.students || [];
    if (!filter.trim()) return all;
    const f = filter.trim().toLowerCase();
    return all.filter((x) => {
      const u = x.student?.username || "";
      const n = x.student?.display_name || "";
      const c = x.student?.class_name || "";
      return `${u} ${n} ${c}`.toLowerCase().includes(f);
    });
  }, [data, filter]);

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 1100, margin: "40px auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <h1>Admin</h1>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a href="/train">← Training</a>
          <button onClick={logout}>Logout</button>
        </div>
      </div>

      {msg && <p style={{ color: msg.includes("Kein") ? "#b00" : "#666" }}>{msg}</p>}

      {data && (
        <>
          <p style={{ color: "#666" }}>
            Stand: <b>{data.today}</b> • Schüler: <b>{rows.length}</b>
          </p>

          <div style={{ margin: "14px 0" }}>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Suche: username / Name / Klasse"
              style={{ width: "100%", padding: 10, fontSize: 14 }}
            />
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={th}>Username</th>
                  <th style={th}>Name</th>
                  <th style={th}>Klasse</th>
                  <th style={th}>Fällig heute</th>
                  <th style={th}>Karten gesamt</th>
                  <th style={th}>Meister (K5)</th>
                  <th style={th}>Kasten 1–5</th>
                  <th style={th}>Letztes Üben</th>
                  <th style={th}>Üben (7 Tage)</th>
                  <th style={th}>Tage (7)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.student;
                  const sc = r.stageCounts || [0, 0, 0, 0, 0];
                  const boxText = `1:${sc[0]}  2:${sc[1]}  3:${sc[2]}  4:${sc[3]}  5:${sc[4]}`;
                  return (
                    <tr key={s.auth_user_id}>
                      <td style={td}><b>{s.username}</b></td>
                      <td style={td}>{s.display_name || "-"}</td>
                      <td style={td}>{s.class_name || "-"}</td>
                      <td style={td}><b>{r.dueNow ?? "-"}</b></td>
                      <td style={td}>{r.totalCards ?? "-"}</td>
                      <td style={td}>{r.mastered ?? 0}</td>
                      <td style={td} title={boxText}>
                        <MiniBars counts={sc} />
                      </td>
                      <td style={td}>{fmtDateTime(r.activity?.lastPracticeAt)}</td>
                      <td style={td}>{r.activity?.minutes7d ?? 0} min</td>
                      <td style={td}>{r.activity?.daysPracticed7d ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 26 }}>Übungstage & Dauer (letzte 30 Tage)</h2>
          <p style={{ color: "#666" }}>
            Tipp: Suche oben einen Schüler und scrolle dann hier – pro Schüler siehst du die Tageswerte.
          </p>

          {rows.map((r) => {
            const s = r.student;
            const days = r.activity?.days || [];
            return (
              <div key={s.auth_user_id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, marginTop: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <b>{s.username}</b> {s.display_name ? `(${s.display_name})` : ""} {s.class_name ? `• ${s.class_name}` : ""}
                  </div>
                  <div style={{ color: "#666" }}>
                    7 Tage: <b>{r.activity?.minutes7d ?? 0} min</b> • Übungstage: <b>{r.activity?.daysPracticed7d ?? 0}</b>
                  </div>
                </div>

                {!days.length ? (
                  <p style={{ color: "#666", marginTop: 8 }}>Keine Sessions in den letzten 30 Tagen.</p>
                ) : (
                  <div style={{ overflowX: "auto", marginTop: 8 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 650 }}>
                      <thead>
                        <tr style={{ background: "#fafafa" }}>
                          <th style={th}>Tag</th>
                          <th style={th}>Dauer</th>
                          <th style={th}>Karten</th>
                          <th style={th}>Richtig</th>
                          <th style={th}>Falsch</th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.slice(0, 14).map((d) => (
                          <tr key={d.date}>
                            <td style={td}><b>{d.date}</b></td>
                            <td style={td}>{Math.round((d.seconds || 0) / 60)} min</td>
                            <td style={td}>{d.cards || 0}</td>
                            <td style={td}>{d.correct || 0}</td>
                            <td style={td}>{d.wrong || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p style={{ color: "#777", marginTop: 8, fontSize: 12 }}>
                      Anzeige: die letzten 14 Tage (von insgesamt bis zu 30 Tagen).
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}

function MiniBars({ counts }) {
  const total = (counts || []).reduce((a, b) => a + b, 0) || 1;

  const parts = [
    { v: counts?.[0] || 0, bg: "#f8d7da" }, // K1 rot
    { v: counts?.[1] || 0, bg: "#fff3cd" }, // K2 gelb
    { v: counts?.[2] || 0, bg: "#d1ecf1" }, // K3 blau
    { v: counts?.[3] || 0, bg: "#d4edda" }, // K4 grün
    { v: counts?.[4] || 0, bg: "#c3e6cb" }, // K5 grün+
  ];

  return (
    <div style={{ display: "flex", height: 12, borderRadius: 999, overflow: "hidden", background: "#eee", minWidth: 180 }}>
      {parts.map((p, i) => (
        <div
          key={i}
          style={{
            width: `${Math.round((p.v / total) * 100)}%`,
            background: p.bg,
          }}
          title={`Kasten ${i + 1}: ${p.v}`}
        />
      ))}
    </div>
  );
}

const th = {
  textAlign: "left",
  padding: "10px 10px",
  fontSize: 13,
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const td = {
  padding: "10px 10px",
  fontSize: 13,
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "top",
  whiteSpace: "nowrap",
};
