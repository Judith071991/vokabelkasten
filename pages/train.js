import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { nextStageAndDue, todayYMD } from "../lib/srs";
import { useRouter } from "next/router";

const NEW_PER_DAY = 25;   // 20–30
const SESSION_LIMIT = 20;

function addDaysYMD(ymd, days) {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export default function Train() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [msg, setMsg] = useState("");
  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  // Anzeige oben
  const [newRemainingToday, setNewRemainingToday] = useState(NEW_PER_DAY);
  const [learnedPct, setLearnedPct] = useState(0);     // stage > 0
  const [masterPct, setMasterPct] = useState(0);       // stage == 4
  const [masteredCount, setMasteredCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const current = useMemo(() => cards[idx] || null, [cards, idx]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.push("/");
      setUser(data.session.user);

      await ensureProgressInitialized(data.session.user.id);

      // Session starten
      const { data: sess, error: sessErr } = await supabase
        .from("practice_sessions")
        .insert({ user_id: data.session.user.id })
        .select("id")
        .single();
      if (!sessErr) setSessionId(sess.id);

      await loadDueCards(data.session.user.id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // Vergleich (tolerant + Varianten + 1 Tippfehler)
  // -------------------------
  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }

  function canonical(text) {
    let t = normalize(text);
    t = t.replace(/\bim\b/g, "i am");
    t = t.replace(/\bi'm\b/g, "i am");
    t = t.replace(/\bi’m\b/g, "i am");
    t = t.replace(/'/g, "");
    return t;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[m][n];
  }

  function splitSolutions(englishField) {
    return String(englishField || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isCorrectAnswer(givenRaw, englishField) {
    const given = canonical(givenRaw);
    const solutionsRaw = splitSolutions(englishField);

    for (const sol of solutionsRaw) if (given === canonical(sol)) return true;

    for (const sol of solutionsRaw) {
      const s = canonical(sol);
      const minLen = Math.min(given.length, s.length);
      if (minLen >= 5 && levenshtein(given, s) <= 1) return true;
    }
    return false;
  }

  // -------------------------
  // Setup: Progress initialisieren (Tag-Reihenfolge, 25/Tag)
  // -------------------------
  async function ensureProgressInitialized(userId) {
    const { count } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (count && count > 0) return;

    const { data: vocab } = await supabase
      .from("vocab")
      .select("id, day")
      .order("day", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true });

    if (!vocab?.length) return;

    const start = todayYMD();
    const batchSize = 200;

    const rows = vocab.map((v, i) => ({
      user_id: userId,
      vocab_id: v.id,
      stage: 0,
      due_date: addDaysYMD(start, Math.floor(i / NEW_PER_DAY)),
      first_seen_date: null,
    }));

    for (let i = 0; i < rows.length; i += batchSize) {
      await supabase.from("progress").insert(rows.slice(i, i + batchSize));
    }
  }

  // -------------------------
  // Counter: neu-heute + Fortschritt (Gelernt & Meister)
  // -> WICHTIG: gibt Werte zurück, damit loadDueCards sie sofort nutzen kann
  // -------------------------
  async function refreshCounters(userId) {
    const today = todayYMD();

    // neu heute = first_seen_date == heute
    const { count: newToday } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("first_seen_date", today);

    const remaining = Math.max(0, NEW_PER_DAY - (newToday || 0));
    setNewRemainingToday(remaining);

    // total
    const { count: total } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    // meister (stage 4)
    const { count: mastered } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("stage", 4);

    // gelernt (stage > 0) – steigt sofort nach dem ersten Üben
    const { count: learned } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("stage", 0);

    const t = total || 0;
    const m = mastered || 0;
    const l = learned || 0;

    setTotalCount(t);
    setMasteredCount(m);

    setMasterPct(t > 0 ? Math.round((m / t) * 100) : 0);
    setLearnedPct(t > 0 ? Math.round((l / t) * 100) : 0);

    return { remaining };
  }

  // -------------------------
  // Laden: erst Wiederholungen, dann neue (max "neu heute")
  // -------------------------
  async function loadDueCards(userIdOverride) {
    setMsg("");
    setFeedback(null);
    setAnswer("");
    setIdx(0);

    const today = todayYMD();

    const uid = userIdOverride || user?.id;
    if (!uid) return;

    // Fix: remaining direkt von refreshCounters nehmen (nicht aus altem State)
    const { remaining } = await refreshCounters(uid);

    // 1) Wiederholungen (stage > 0)
    const { data: rev, error: revErr } = await supabase
      .from("progress")
      .select("id, stage, due_date, correct_count, wrong_count, first_seen_date, vocab: vocab_id (id, german, english, is_idiom)")
      .eq("user_id", uid)
      .lte("due_date", today)
      .gt("stage", 0)
      .order("due_date", { ascending: true })
      .limit(SESSION_LIMIT);

    if (revErr) return setMsg("Fehler beim Laden.");

    const mappedRev = (rev || []).map((p) => ({
      progress_id: p.id,
      stage: p.stage,
      due_date: p.due_date,
      correct_count: p.correct_count,
      wrong_count: p.wrong_count,
      first_seen_date: p.first_seen_date,
      vocab_id: p.vocab.id,
      german: p.vocab.german,
      english: p.vocab.english,
      is_idiom: p.vocab.is_idiom,
    }));

    const remainingSlots = SESSION_LIMIT - mappedRev.length;

    // 2) Neue Karten (stage = 0), aber nur bis "neu heute" voll ist
    let mappedNew = [];
    const allowNew = Math.min(remainingSlots, remaining);

    if (allowNew > 0) {
      const { data: neu, error: newErr } = await supabase
        .from("progress")
        .select("id, stage, due_date, correct_count, wrong_count, first_seen_date, vocab: vocab_id (id, german, english, is_idiom)")
        .eq("user_id", uid)
        .lte("due_date", today)
        .eq("stage", 0)
        .is("first_seen_date", null)
        .order("due_date", { ascending: true })
        .limit(allowNew);

      if (newErr) return setMsg("Fehler beim Laden.");

      mappedNew = (neu || []).map((p) => ({
        progress_id: p.id,
        stage: p.stage,
        due_date: p.due_date,
        correct_count: p.correct_count,
        wrong_count: p.wrong_count,
        first_seen_date: p.first_seen_date,
        vocab_id: p.vocab.id,
        german: p.vocab.german,
        english: p.vocab.english,
        is_idiom: p.vocab.is_idiom,
      }));
    }

    const combined = [...mappedRev, ...mappedNew];
    setCards(combined);
    if (!combined.length) setMsg("Heute ist nichts fällig 🎉");
  }

  // -------------------------
  // Session Tracking
  // -------------------------
  async function markActivity(correct) {
    if (!sessionId || !user) return;

    const { data: s } = await supabase
      .from("practice_sessions")
      .select("cards_answered, correct_answers, wrong_answers")
      .eq("id", sessionId)
      .single();

    await supabase
      .from("practice_sessions")
      .update({
        last_activity_at: new Date().toISOString(),
        cards_answered: (s?.cards_answered || 0) + 1,
        correct_answers: (s?.correct_answers || 0) + (correct ? 1 : 0),
        wrong_answers: (s?.wrong_answers || 0) + (correct ? 0 : 1),
      })
      .eq("id", sessionId);
  }

  async function endSession() {
    if (!sessionId) return;

    const { data: s } = await supabase
      .from("practice_sessions")
      .select("started_at")
      .eq("id", sessionId)
      .single();

    const started = s?.started_at ? new Date(s.started_at) : null;
    const ended = new Date();
    const dur = started ? Math.max(0, Math.round((ended - started) / 1000)) : 0;

    await supabase
      .from("practice_sessions")
      .update({
        ended_at: ended.toISOString(),
        duration_seconds: dur,
        last_activity_at: ended.toISOString(),
      })
      .eq("id", sessionId);
  }

  // -------------------------
  // Training
  // -------------------------
  async function check() {
    if (!current) return;

    const correct = isCorrectAnswer(answer, current.english);
    const solutions = splitSolutions(current.english);
    const shownSolution = solutions[0] || current.english;

    setFeedback({ correct, solution: shownSolution, allSolutions: solutions });

    const today = todayYMD();

    const setFirstSeen = current.first_seen_date ? {} : { first_seen_date: today };
    const { newStage, due_date } = nextStageAndDue(current.stage, correct);

    await supabase
      .from("progress")
      .update({
        stage: newStage,
        due_date,
        last_seen: today,
        correct_count: (current.correct_count || 0) + (correct ? 1 : 0),
        wrong_count: (current.wrong_count || 0) + (correct ? 0 : 1),
        ...setFirstSeen,
      })
      .eq("id", current.progress_id);

    await markActivity(correct);
    if (user?.id) await refreshCounters(user.id);
  }

  async function next() {
    setFeedback(null);
    setAnswer("");
    if (idx + 1 < cards.length) setIdx(idx + 1);
    else {
      setMsg("Session fertig ✅");
      await endSession();
      if (user?.id) await loadDueCards(user.id);
    }
  }

  async function logout() {
    await endSession();
    await supabase.auth.signOut();
    router.push("/");
  }

  function stageUI(stageRaw) {
    const stage = typeof stageRaw === "number" ? stageRaw : 0;
    const boxNum = Math.min(5, Math.max(1, stage + 1));
    const pct = ((boxNum - 1) / 4) * 100;
    const bg =
      stage === 0 ? "#f8d7da" :
      stage === 1 ? "#fff3cd" :
      stage === 2 ? "#d1ecf1" :
      stage === 3 ? "#d4edda" :
      "#c3e6cb";
    const title = stage === 4 ? `🏆 Meister (Kasten ${boxNum}/5)` : `📦 Kasten ${boxNum} von 5`;
    return { bg, pct, title };
  }

  const ui = stageUI(current?.stage);

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h1>Training (DE → EN)</h1>
        <button onClick={logout}>Logout</button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", color: "#666" }}>
        <div>{cards.length ? `Karte ${idx + 1} von ${cards.length}` : ""}</div>
        <div>
          Heute noch <b>{newRemainingToday}</b> neue Karten •
          Gelernt: <b>{learnedPct}%</b> •
          Meister: <b>{masterPct}%</b>{" "}
          <span style={{ color: "#888" }}>({masteredCount}/{totalCount})</span>
        </div>
      </div>

      {msg && <p style={{ color: "#0a6" }}>{msg}</p>}

      {current && (
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 10, marginTop: 10 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "inline-block", padding: "6px 12px", borderRadius: 20, background: ui.bg, color: "#333", fontWeight: 800, fontSize: 14, marginBottom: 10 }}>
              {ui.title}
            </div>

            <div style={{ height: 8, background: "#eee", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${ui.pct}%`, background: ui.bg }} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, color: "#777", fontSize: 12 }}>
              <span>Kasten 1</span><span>Kasten 5</span>
            </div>
          </div>

          <div style={{ background: current.is_idiom ? "#fff3b0" : "transparent", padding: 10, borderRadius: 8, fontSize: 20, marginBottom: 12 }}>
            {current.german}
          </div>

          <label>Englisch</label>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={!!feedback}
            style={{ width: "100%", padding: 12, margin: "6px 0 12px", fontSize: 16 }}
            placeholder="Type the English word/phrase"
          />

          {!feedback ? (
            <button onClick={check} style={{ padding: "10px 14px" }}>Prüfen</button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 800, color: feedback.correct ? "#0a6" : "#b00" }}>
                {feedback.correct ? "Richtig ✅" : "Falsch ❌"}
              </p>

              {!feedback.correct && (
                <>
                  <p>Richtige Lösung: <b>{feedback.solution}</b></p>
                  {feedback.allSolutions?.length > 1 && (
                    <p style={{ color: "#666", marginTop: 6 }}>
                      Weitere akzeptierte Lösungen: <b>{feedback.allSolutions.slice(1).join(" • ")}</b>
                    </p>
                  )}
                </>
              )}

              <button onClick={next} style={{ padding: "10px 14px" }}>Nächste</button>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={() => loadDueCards(user?.id)} style={{ padding: "10px 14px" }}>Fällige neu laden</button>{" "}
        <a href="/admin" style={{ marginLeft: 10 }}>Admin</a>
      </div>
    </main>
  );
}
