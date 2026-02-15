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
      .select("id, stage, due_date, correct_count, wrong_count, vocab: vocab_id (id, german, english, is_idiom)")
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

  async function check() {
  if (!current) return;

  function normalize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[’‘]/g, "'")     // geschwungene Apostrophe → '
      .replace(/[“”]/g, '"')     // geschwungene Anführungszeichen → "
      .replace(/\s+/g, " ")      // mehrere Leerzeichen → eins
      .trim();
  }

  const given = normalize(answer);
  const solution = normalize(current.english);
  const correct = given === solution;

  setFeedback({ correct, solution: current.english });

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

  async function logout() {
    await endSession();
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h1>Training (DE → EN)</h1>
        <button onClick={logout}>Logout</button>
      </div>

      <p style={{ color: "#666" }}>{cards.length ? `Karte ${idx + 1} von ${cards.length}` : ""}</p>
      {msg && <p style={{ color: "#0a6" }}>{msg}</p>}

      {current && (
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 10 }}>
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
                <p>
                  Richtige Lösung: <b>{feedback.solution}</b>
                </p>
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
