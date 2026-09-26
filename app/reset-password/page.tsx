"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function ResetPasswordPage() {
  const params = useSearchParams(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); try { const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset", email: "reset@saaslaunchup.local", token: params.get("token"), password: form.get("password") }) }); const result = await response.json() as { error?: string; redirect?: string }; if (!response.ok) throw new Error(result.error || "Could not reset password."); window.location.assign(result.redirect || "/workspace.html"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reset password."); setBusy(false); } }
  return <main className="auth-page"><section className="auth-panel"><Link className="auth-brand" href="/">SaaS Launchup</Link><p className="auth-kicker">Account security</p><h1>Choose a new password.</h1><p className="auth-copy">Use at least 12 characters. This link can only be used once.</p><form onSubmit={submit} className="auth-form"><label>New password<input name="password" type="password" minLength={12} required autoComplete="new-password" /></label>{error ? <p className="auth-error" role="alert">{error}</p> : null}<button type="submit" disabled={busy}>{busy ? "Saving..." : "Reset password"}</button></form></section></main>;
}