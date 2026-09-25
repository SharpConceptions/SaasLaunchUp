import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const name = user.fullName?.trim() || user.email;
  const initials = user.fullName?.trim()
    ? user.fullName.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("")
    : user.email.slice(0, 2).toUpperCase();
  return Response.json({ name, email: user.email, initials }, { headers: { "Cache-Control": "no-store" } });
}
