import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { nextStageAndDue, todayYMD } from "../lib/srs";
import { useRouter } from "next/router";

export default function Train() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [msg, setMsg] = useState("");
  const [cards, setCards] = useState([]);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [sessionId, setSessionId] = useState(null);

  const current = useMemo(() => cards[idx] || null, [cards, idx]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return router.push("/");
      setUser(data.session.user);

      await ensureProgressInitialized(data.session.user.id);

      const { data: sess, error: sessErr } = await supabase
        .from("practice_sessions")
        .insert({ user_id: data.session.user.id })
        .select("id")
        .single();
      if (!sessErr) setSessionId(sess.id);

      await loadDueCards();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------
  // Schritt 1+2: Vergleichslogik
  // -------------------------

  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'") // geschwungene Apostrophe → '
      .replace(/[“”]/g, '"') // geschwungene Anführungszeichen → "
      .replace(/\s+/g, " ") // mehrere Leerzeichen → eins
      .trim();
  }

  // Canonical: macht Varianten möglichst gleich
  // - i'm / i’m / im / i am → i am
  // - apostrophe egal
  function canonical(text) {
    let t = normalize(text);
    t = t.replace(/\bim\b/g, "i am");
    t = t.replace(/\bi'm\b/g, "i am");
    t = t.replace(/\bi’m\b/g, "i am"); // falls typografisch drin bleibt
    t = t.replace(/'/g, "");
    return t;
  }

  // Levenshtein-Distanz (für 1 kleinen Tippfehler)
  function levenshtein(a, b) {
    const m = a.length,
      n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  // Step 2: Mehrere Lösungen erlauben:
  // current.english kann Varianten enthalten, getrennt durch ';'
  function splitSolutions(englishField) {
    return String(englishField || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function isCorrectAnswer(givenRaw, englishField) {
    const given = canonical(givenRaw);
    const solutionsRaw = splitSolutions(englishField);

    // Erst: exakter Match nach canonical gegen irgendeine Lösung
    for (const sol of solutionsRaw) {
      if (given === canonical(sol)) return true;
    }

    // Dann: 1 Tippfehler erlauben (nur wenn nicht zu kurz)
    // Damit "to" nicht versehentlich alles matcht.
    for (const sol of solutionsRaw) {
      const s = canonical(sol);
      const minLen = Math.min(given.length, s.length);
      if (minLen >= 5) {
        const dist = levenshtein(given, s);
        if (dist <= 1) return true;
      }
    }

    return false;
  }

  // -------------------------
  // Datenladen / Setup
  // -------------------------

  async function ensureProgressInitialized(userId) {
    const { count } = await supabase
      .from("progress")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (count && count > 0) return;

    const { data: vocab } = await supabase.from("vocab").select("id");
    if (!vocab?.length) return;

    const batchSize = 200;
    for (let i = 0; i < vocab.length; i += batchSize) {
      const batch = vocab.slice(i, i + batchSize).map((v) => ({
        user_id: userId,
        vocab_id: v.id,
        stage: 0,
        due_date: todayYMD(),
      }));
      await supabase.from("progress").insert(batch);
    }
  }

  async function loadDueCards() {
    setMsg("");
    setFeedback(null);
    setAnswer("");
    setIdx(0);

    const today = todayYMD();

    const { data, error } = await supabase
      .from("progress")
      .select(
        "id, stage, due_date, correct_count, wrong_count, vocab: vocab_id (id, german, english, is_idiom)"
      )
      .lte("due_date", today)
      .order("due_date", { ascending: true })
      .limit(20);

    if (error) return setMsg("Fehler beim Laden.");

    const mapped = (data || []).map((p) => ({
      progress_id: p.id,
      stage: p.stage,
      due_date: p.due_date,
      correct_count: p.correct_count,
      wrong_count: p.wrong_count,
      vocab_id: p.vocab.id,
      german: p.vocab.german,
      english: p.vocab.english,
      is_idiom: p.vocab.is_idiom,
    }));

    setCards(mapped);
    if (!mapped.length) setMsg("Heute ist nichts fällig 🎉");
  }

  // -------------------------
  // Session Tracking (Übungszeit)
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
  // Training: Prüfen / Nächste / Logout
  // -------------------------

  async function check() {
    if (!current) return;

    const correct = isCorrectAnswer(answer, current.english);

    // Für Feedback: zeige erste Lösung (oder ganze Liste)
    const solutions = splitSolutions(current.english);
    const shownSolution = solutions[0] || current.english;

    setFeedback({
      correct,
      solution: shownSolution,
      allSolutions: solutions,
    });

    const { newStage, due_date } = nextStageAndDue(current.stage, correct);

    await supabase
      .from("progress")
      .update({
        stage: newStage,
        due_date,
        last_seen: todayYMD(),
        correct_count: (current.correct_count || 0) + (correct ? 1 : 0),
        wrong_count: (current.wrong_count || 0) + (correct ? 0 : 1),
      })
      .eq("id", current.progress_id);

    await markActivity(correct);
  }

  async function next() {
    setFeedback(null);
    setAnswer("");
    if (idx + 1 < cards.length) setIdx(idx + 1);
    else {
      setMsg("Session fertig ✅");
      await endSession();
      await loadDueCards();
    }
  }

  async function logout() {
    await endSession();
    await supabase.auth.signOut();
    router.push("/");
  }

  // -------------------------
  // UI (Schritt 3: Stufe anzeigen)
  // -------------------------

  const stageLabel = current ? `Kasten ${current.stage + 1} / 5` : "";

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h1>Training (DE → EN)</h1>
        <button onClick={logout}>Logout</button>
      </div>

      <p style={{ color: "#666" }}>
        {cards.length ? `Karte ${idx + 1} von ${cards.length}` : ""}
        {current ? ` • ${stageLabel}` : ""}
      </p>

      {msg && <p style={{ color: "#0a6" }}>{msg}</p>}

      {current && (
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 10 }}>
        <div
  style={{
    fontSize: 14,
    fontWeight: 600,
    color: "#666",
    marginBottom: 8
  }}
>
  Kasten {current.stage + 1} von 5
</div>
          <div
            style={{
              background: current.is_idiom ? "#fff3b0" : "transparent",
              padding: 10,
              borderRadius: 8,
              fontSize: 20,
              marginBottom: 12,
            }}
          >
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
            <button onClick={check} style={{ padding: "10px 14px" }}>
              Prüfen
            </button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 700, color: feedback.correct ? "#0a6" : "#b00" }}>
                {feedback.correct ? "Richtig ✅" : "Falsch ❌"}
              </p>

              {!feedback.correct && (
                <>
                  <p>
                    Richtige Lösung: <b>{feedback.solution}</b>
                  </p>
                  {feedback.allSolutions?.length > 1 && (
                    <p style={{ color: "#666", marginTop: 6 }}>
                      Weitere akzeptierte Lösungen:{" "}
                      <b>{feedback.allSolutions.slice(1).join(" • ")}</b>
                    </p>
                  )}
                </>
              )}

              <button onClick={next} style={{ padding: "10px 14px" }}>
                Nächste
              </button>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button onClick={loadDueCards} style={{ padding: "10px 14px" }}>
          Fällige neu laden
        </button>{" "}
        <a href="/admin" style={{ marginLeft: 10 }}>
          Admin
        </a>
      </div>
    </main>
  );
}
