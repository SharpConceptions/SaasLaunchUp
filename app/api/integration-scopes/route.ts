import catalog from "../../../public/integration-scopes.json";
import { implementedScopes } from "../../../lib/integration-permissions";

export async function GET() {
  return Response.json({ items: catalog.map(item => ({ ...item, available: implementedScopes.has(item.key) })) }, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
