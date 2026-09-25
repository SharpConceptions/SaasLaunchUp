export type FieldMapping = {
  name?: string; email?: string; phone?: string; company?: string;
  domain?: string; source?: string; message?: string; submission_id?: string;
};

export function createWebsiteKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "nc_live_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashWebsiteKey(key: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function equalHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
