const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return base64Url(new Uint8Array(signature));
}

export async function createSession(login: string, secret: string, now = Date.now()): Promise<string> {
  const expiresAt = Math.floor(now / 1000) + 12 * 60 * 60;
  const payload = `${login}|${expiresAt}`;
  return `${payload}|${await hmac(secret, payload)}`;
}

export async function verifySession(
  value: string | undefined,
  expectedLogin: string,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split("|");
  if (parts.length !== 3) return false;
  const [login, expiresAtRaw, signature] = parts;
  if (login !== expectedLogin) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const expected = await hmac(secret, `${login}|${expiresAtRaw}`);
  return signature === expected;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure = true): string {
  const secureAttribute = secure ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly${secureAttribute}; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
