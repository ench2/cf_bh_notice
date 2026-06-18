const SESSION_COOKIE = "notice_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

export async function createSessionCookie(password: string, requestUrl: string, now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = `admin.${expiresAt}`;
  const signature = await sign(payload, password);
  const url = new URL(requestUrl);
  const secure = url.protocol === "https:" || !["localhost", "127.0.0.1"].includes(url.hostname);

  return [
    `${SESSION_COOKIE}=${base64UrlEncode(payload)}.${signature}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

export async function isAuthenticated(request: Request, password: string, now = Date.now()): Promise<boolean> {
  const cookie = getCookie(request.headers.get("Cookie") ?? "", SESSION_COOKIE);
  if (!cookie) return false;

  const [encodedPayload, actualSignature] = cookie.split(".");
  if (!encodedPayload || !actualSignature) return false;

  const payload = base64UrlDecode(encodedPayload);
  const expectedSignature = await sign(payload, password);
  if (!constantTimeEqual(actualSignature, expectedSignature)) return false;

  const parts = payload.split(".");
  if (parts.length !== 2 || parts[0] !== "admin") return false;

  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

function getCookie(cookieHeader: string, name: string): string | undefined {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function base64UrlEncode(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
