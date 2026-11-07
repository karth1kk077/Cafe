import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { AlertIcon, ArrowLeftIcon, BrandCupIcon } from "../components/ui/Icon";

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
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm overflow-hidden animate-rise">
        <div className="hero-ink px-6 pb-6 pt-6">
          <span className="brand-mark mb-4">
            <BrandCupIcon size={22} />
          </span>
          <h1 className="display text-3xl font-semibold leading-tight">Smart Café</h1>
          <p className="mt-1 text-sm text-white/65">Staff sign in</p>
        </div>

        <div className="space-y-4 px-6 py-6">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              <AlertIcon size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="text-sm font-semibold" htmlFor="staff-email">
              Email
            </label>
            <input
              id="staff-email"
              className="input mt-1"
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="text-sm font-semibold" htmlFor="staff-password">
              Password
            </label>
            <input
              id="staff-password"
              className="input mt-1"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </div>
      </form>

      <Link to="/" className="btn btn-ghost mt-3 !min-h-10 px-3 text-sm">
        <ArrowLeftIcon size={16} />
        Back to start
      </Link>
    </div>
  );
}
