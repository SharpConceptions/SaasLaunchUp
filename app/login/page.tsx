"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Mode = "login" | "register" | "forgot";

export default function LoginPage() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const returnTo = params.get("return_to")?.startsWith("/") ? params.get("return_to")! : "/console.html";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    const body = { action: mode, email: form.get("email"), password: form.get("password") || undefined, display_name: form.get("display_name") || undefined };
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; message?: string; redirect?: string };
      if (!response.ok) throw new Error(result.error || "Authentication failed.");
      if (mode === "forgot") { setMessage(result.message || "Check your email for reset instructions."); setBusy(false); return; }
      window.location.assign(mode === "register" ? result.redirect || "/onboarding" : returnTo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authentication failed."); setBusy(false); }
  }

  const title = mode === "login" ? "Welcome back" : mode === "register" ? "Create your account" : "Reset your password";
  return <main className="auth-page"><section className="auth-panel">
    <Link className="auth-brand" href="/">SaaS Launchup</Link><p className="auth-kicker">Your company workspace</p><h1>{title}</h1>
    <p className="auth-copy">{mode === "login" ? "Sign in to continue to your sales and operations workspace." : mode === "register" ? "Create an owner account, then complete the guided workspace setup." : "Enter your email and we will help you recover access."}</p>
    <form onSubmit={submit} className="auth-form">
      {mode === "register" ? <label>Your name<input name="display_name" autoComplete="name" required /></label> : null}
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      {mode !== "forgot" ? <label>Password<input name="password" type="password" minLength={12} autoComplete={mode === "login" ? "current-password" : "new-password"} required /><span>Use at least 12 characters.</span></label> : null}
      {error ? <p className="auth-error" role="alert">{error}</p> : null}{message ? <p className="auth-success" role="status">{message}</p> : null}
      <button type="submit" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send reset instructions"}</button>
    </form>
    {mode === "login" ? <><button className="google-button" type="button" onClick={() => { window.location.assign("/api/auth/google"); }}>Continue with Google</button><button className="auth-link" type="button" onClick={() => { setMode("forgot"); setError(""); }}>Forgot password?</button><button className="auth-switch" type="button" onClick={() => { setMode("register"); setError(""); }}>Create an account</button></> : <button className="auth-switch" type="button" onClick={() => { setMode("login"); setError(""); }}>Back to sign in</button>}
  </section></main>;
}
