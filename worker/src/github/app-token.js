/**
 * GitHub App installation token management.
 *
 * Generates short-lived JWTs signed with the App's private key (RS256),
 * exchanges them for installation access tokens, and caches tokens in KV
 * with a ~55-minute TTL to minimize KV writes (~1 write/hour).
 *
 * Uses the Web Crypto API (available in Cloudflare Workers) for RS256 signing.
 */

const KV_TOKEN_KEY = 'github_app_token';
const TOKEN_CACHE_TTL = 55 * 60; // 55 minutes (tokens last 60 min)
const APP_JWT_LIFETIME = 600;     // 10 minutes (GitHub's max for App JWTs)

/**
 * Import a PKCS#8 PEM private key for RS256 signing.
 */
async function importPrivateKey(pemKey) {
  // Strip PEM headers and newlines
  const pemBody = pemKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const binaryString = atob(pemBody);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/**
 * Base64url encode.
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
 * Create a short-lived JWT for GitHub App authentication (RS256).
 * This is NOT the user session JWT — it's the App-to-GitHub auth token.
 */
async function createAppJWT(appId, privateKey) {
  const key = await importPrivateKey(privateKey);

  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // Clock skew tolerance
    exp: now + APP_JWT_LIFETIME,
    iss: appId,
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Exchange the App JWT for an installation access token.
 */
async function requestInstallationToken(appJWT, installationId) {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJWT}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'poly-convergence-bot',
      },
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.token;
}

/**
 * Get a valid GitHub App installation token.
 * Uses KV cache to avoid re-generating tokens on every request.
 *
 * Cache strategy:
 * - Check KV for a cached token
 * - If found and not expired, use it (KV read only — free)
 * - If not found or expired, generate a new one and cache it (~1 KV write/hour)
 *
 * @param {Object} env - Worker environment bindings
 * @returns {Promise<string>} Installation access token
 */
export async function getInstallationToken(env) {
  // Try KV cache first
  const cached = await env.SUBMISSIONS_KV.get(KV_TOKEN_KEY);
  if (cached) {
    try {
      const { token, expires_at } = JSON.parse(cached);
      // Use cached token if it has at least 5 minutes of life left
      if (Date.now() < expires_at - 5 * 60 * 1000) {
        return token;
      }
    } catch {
      // Corrupted cache entry, regenerate
    }
  }

  // Generate new token
  const appJWT = await createAppJWT(
    env.GITHUB_APP_ID,
    env.GITHUB_APP_PRIVATE_KEY
  );

  const token = await requestInstallationToken(
    appJWT,
    env.GITHUB_APP_INSTALLATION_ID
  );

  // Cache with ~55-min TTL
  const expiresAt = Date.now() + TOKEN_CACHE_TTL * 1000;
  await env.SUBMISSIONS_KV.put(
    KV_TOKEN_KEY,
    JSON.stringify({ token, expires_at: expiresAt }),
    { expirationTtl: TOKEN_CACHE_TTL }
  );

  return token;
}
