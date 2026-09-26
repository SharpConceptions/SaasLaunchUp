export async function GET() {
  return Response.json({ error: "Google sign-in is not configured yet. Use email and password for now." }, { status: 501, headers: { "Cache-Control": "no-store" } });
}