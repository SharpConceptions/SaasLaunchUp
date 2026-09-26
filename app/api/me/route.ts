import { getRequestIdentity } from "../../../lib/access-identity";

export async function GET(request: Request) {
  const user = await getRequestIdentity(request.headers);
  if (!user) return Response.json({ error: "Sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const name = user.displayName?.trim() || user.email;
  const initials = user.displayName?.trim()
    ? user.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() || "").join("")
    : user.email.slice(0, 2).toUpperCase();
  return Response.json({ name, email: user.email, initials }, { headers: { "Cache-Control": "no-store" } });
}
