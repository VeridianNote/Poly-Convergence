/**
 * CORS middleware for the Cloudflare Worker.
 *
 * Allows credentialed requests from the main site only.
 * Handles preflight OPTIONS requests automatically.
 */

/**
 * Get the allowed origin for CORS responses.
 * Only the main site URL is allowed (no wildcards with credentials).
 */
function getAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  // In production, only allow the main site. In dev, also allow localhost.
  const allowed = [env.SITE_URL];
  if (env.SITE_URL.includes('localhost')) {
    allowed.push('http://localhost:3000');
  }
  if (origin && allowed.includes(origin)) {
    return origin;
  }
  return null;
}

/**
 * Add CORS headers to a Response.
 */
export function withCors(response, request, env) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Handle preflight OPTIONS requests.
 * Returns a 204 with CORS headers if the origin is allowed.
 */
export function handlePreflight(request, env) {
  const origin = getAllowedOrigin(request, env);
  if (!origin) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
