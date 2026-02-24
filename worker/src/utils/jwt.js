/**
 * JWT utilities for session management.
 *
 * Uses HMAC-SHA256 via the Web Crypto API (available in Cloudflare Workers).
 * The JWT is stored in an HttpOnly cookie and contains user identity +
 * the last_draft_save timestamp (to throttle draft saves without KV writes).
 */

const ALGORITHM = { name: 'HMAC', hash: 'SHA-256' };
const JWT_LIFETIME_SECONDS = 3600; // 1 hour

/**
 * Import the JWT signing secret as a CryptoKey.
 * Cached per-request via the env object (Workers are stateless across requests).
 */
async function getSigningKey(secret) {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    ALGORITHM,
    false,
    ['sign', 'verify']
  );
}

/**
 * Base64url encode a buffer or string.
 */
function base64url(input) {
  const bytes = typeof input === 'string'
    ? new TextEncoder().encode(input)
    : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64url decode to a string.
 */
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Create a signed JWT with the given payload.
 *
 * @param {Object} payload - The JWT payload (sub, username, avatar, etc.)
 * @param {string} secret - The HMAC secret
 * @returns {Promise<string>} The signed JWT string
 */
export async function createJWT(payload, secret) {
  const key = await getSigningKey(secret);

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + JWT_LIFETIME_SECONDS,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(fullPayload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Verify and decode a JWT.
 *
 * @param {string} token - The JWT string
 * @param {string} secret - The HMAC secret
 * @returns {Promise<Object|null>} The decoded payload, or null if invalid/expired
 */
export async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Validate algorithm — reject tokens with unexpected alg
    const header = JSON.parse(base64urlDecode(headerB64));
    if (header.alg !== 'HS256') return null;

    const key = await getSigningKey(secret);

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;

    // Decode signature from base64url to binary
    let sigB64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    while (sigB64.length % 4) sigB64 += '=';
    const sigBinary = atob(sigB64);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(signingInput)
    );

    if (!valid) return null;

    // Decode payload
    const payload = JSON.parse(base64urlDecode(payloadB64));

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    // Validate required claims
    if (!payload.sub || !payload.username) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Create an HttpOnly session cookie string for the JWT.
 *
 * @param {string} token - The JWT string
 * @param {string} domain - Cookie domain (e.g., ".polyconvergence.com")
 * @returns {string} The Set-Cookie header value
 */
export function createSessionCookie(token, domain) {
  const maxAge = JWT_LIFETIME_SECONDS;
  // Use Lax instead of Strict so the cookie survives the OAuth redirect back
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Domain=${domain}; Path=/; Max-Age=${maxAge}`;
}

/**
 * Create a cookie string that clears the session.
 */
export function clearSessionCookie(domain) {
  return `session=; HttpOnly; Secure; SameSite=Lax; Domain=${domain}; Path=/; Max-Age=0`;
}

/**
 * Extract the session JWT from a request's cookies.
 */
export function getSessionToken(request) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith('session=')) {
      return cookie.substring('session='.length);
    }
  }
  return null;
}
