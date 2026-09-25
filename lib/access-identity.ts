import { env } from "cloudflare:workers";

export type RequestIdentity = { userId: string; email: string };

type AccessClaims = {
  aud?: string | string[];
  email?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
};

type AccessKeySet = { expiresAt: number; keys: JsonWebKey[] };
type AccessEnvironment = { CF_ACCESS_AUD?: string; CF_ACCESS_TEAM_DOMAIN?: string };

const keySets = new Map<string, AccessKeySet>();
const encoder = new TextEncoder();

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

async function getAccessKeys(issuer: string, refresh = false): Promise<JsonWebKey[]> {
  const current = keySets.get(issuer);
  if (!refresh && current && current.expiresAt > Date.now()) return current.keys;

  const response = await fetch(`${issuer}/cdn-cgi/access/certs`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Cloudflare Access keys are unavailable.");

  const result = await response.json() as { keys?: JsonWebKey[] };
  if (!Array.isArray(result.keys)) throw new Error("Cloudflare Access keys are invalid.");

  keySets.set(issuer, { keys: result.keys, expiresAt: Date.now() + 5 * 60 * 1000 });
  return result.keys;
}

async function verifyAccessAssertion(
  assertion: string,
  teamDomain: string,
  audiences: string[],
): Promise<RequestIdentity | null> {
  try {
    const [encodedHeader, encodedClaims, encodedSignature, ...extra] = assertion.split(".");
    if (!encodedHeader || !encodedClaims || !encodedSignature || extra.length) return null;

    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader))) as { alg?: string; kid?: string };
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedClaims))) as AccessClaims;
    if (header.alg !== "RS256" || !header.kid) return null;

    const domain = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const issuer = `https://${domain}`;
    let keys = await getAccessKeys(issuer);
    let jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
    if (!jwk) {
      keys = await getAccessKeys(issuer, true);
      jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA");
    }
    if (!jwk) return null;

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64Url(encodedSignature),
      encoder.encode(`${encodedHeader}.${encodedClaims}`),
    );
    if (!verified) return null;

    const now = Math.floor(Date.now() / 1000);
    const tokenAudiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !tokenAudiences.some(value => value && audiences.includes(value))) return null;
    if (typeof claims.exp !== "number" || claims.exp <= now) return null;
    if (typeof claims.nbf === "number" && claims.nbf > now) return null;
    if (!claims.sub || !claims.email) return null;

    return { userId: claims.sub, email: claims.email.trim().toLowerCase() };
  } catch {
    return null;
  }
}

export async function getRequestIdentity(headers: Headers): Promise<RequestIdentity | null> {
  const configuration = env as unknown as AccessEnvironment;
  const assertion = headers.get("cf-access-jwt-assertion");

  if (configuration.CF_ACCESS_AUD || configuration.CF_ACCESS_TEAM_DOMAIN) {
    if (!configuration.CF_ACCESS_AUD || !configuration.CF_ACCESS_TEAM_DOMAIN || !assertion) return null;
    const audiences = configuration.CF_ACCESS_AUD.split(",").map(value => value.trim()).filter(Boolean);
    if (!audiences.length) return null;
    return verifyAccessAssertion(assertion, configuration.CF_ACCESS_TEAM_DOMAIN, audiences);
  }

  const userId = headers.get("oai-authenticated-user-id");
  const email = headers.get("oai-authenticated-user-email");
  return userId && email ? { userId, email } : null;
}