import { equalHex, hashWebsiteKey } from "./website-forms";

export function createApiToken(id: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `ncsk_${id.replace(/-/g, "")}_${secret}`;
}

export function tokenId(token: string) {
  const match = /^ncsk_([0-9a-f]{32})_[A-Za-z0-9_-]{43}$/.exec(token);
  if (!match) return null;
  const raw = match[1];
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export { equalHex, hashWebsiteKey };
