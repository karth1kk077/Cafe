import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("waiter@cafe.local");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user.role === "KITCHEN") navigate("/kitchen");
      else if (user.role === "ADMIN") navigate("/admin");
      else navigate("/waiter");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Smart Café</h1>
          <p className="text-sm text-slate-500">Staff sign in</p>
        </div>
        {error && <div className="rounded bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
        <div>
          <label className="text-sm font-semibold">Email</label>
          <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm font-semibold">Password</label>
          <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary w-full" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
