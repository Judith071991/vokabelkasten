import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.push("/train");
    });
  }, [router]);

  async function login() {
    setMsg("");
    const u = username.trim().toLowerCase();
    if (!u) return setMsg("Bitte Username eingeben.");
    const email = `${u}@schule.local`;

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setMsg("Login fehlgeschlagen. Username/Passwort prüfen.");

    router.push("/train");
  }

  return (
    <main style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>VokabelKasten</h1>

      <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 10 }}>
        <h2>Login</h2>

        <label>Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="schueler01"
          style={{ width: "100%", padding: 10, margin: "6px 0 12px" }}
        />

        <label>Passwort</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="••••••••"
          style={{ width: "100%", padding: 10, margin: "6px 0 12px" }}
        />

        <button onClick={login} style={{ padding: "10px 14px" }}>
          Einloggen
        </button>

        {msg && <p style={{ marginTop: 12, color: "#b00020" }}>{msg}</p>}

        <p style={{ marginTop: 12, fontSize: 12, color: "#666" }}>
          Hinweis: Username wird intern als <code>@schule.local</code> genutzt.
        </p>

        <p style={{ marginTop: 12 }}>
          <a href="/admin">Admin</a>
        </p>
      </div>
    </main>
  );
}
