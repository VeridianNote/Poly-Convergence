/**
 * Auth route handlers.
 *
 * /auth/login    → Redirects to GitHub OAuth
 * /auth/callback → Exchanges code for token, creates JWT, redirects back
 * /auth/logout   → Clears session cookie
 */

import { createJWT, createSessionCookie, clearSessionCookie } from '../utils/jwt.js';
import { getOrCreateUser } from '../utils/rate-limit.js';

/**
 * Generate a random state parameter for CSRF protection.
 */
function generateState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * GET /auth/login
 * Initiates the GitHub OAuth flow.
 */
export async function handleLogin(request, env) {
  const state = generateState();

  // Store the state in a short-lived cookie for CSRF validation on callback
  const stateCookie = `oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;

  // Check for a return URL (where to redirect after auth)
  // SECURITY: Validate return_to is a safe relative path (prevent open redirect)
  const url = new URL(request.url);
  let returnTo = url.searchParams.get('return_to') || '/contribute';
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes(':')) {
    returnTo = '/contribute';
  }
  const returnCookie = `oauth_return=${encodeURIComponent(returnTo)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;

  const githubAuthURL = new URL('https://github.com/login/oauth/authorize');
  githubAuthURL.searchParams.set('client_id', env.OAUTH_CLIENT_ID);
  githubAuthURL.searchParams.set('scope', 'read:user');
  githubAuthURL.searchParams.set('redirect_uri', `${env.API_URL}/auth/callback`);
  githubAuthURL.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', githubAuthURL.toString()],
      ['Set-Cookie', stateCookie],
      ['Set-Cookie', returnCookie],
    ],
  });
}

/**
 * GET /auth/callback
 * Handles the OAuth callback from GitHub.
 */
export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return authErrorRedirect(env, 'Missing code or state parameter');
  }

  // Verify CSRF state
  const cookies = parseCookies(request);
  const storedState = cookies.oauth_state;
  if (!storedState || storedState !== state) {
    return authErrorRedirect(env, 'Invalid state — please try signing in again');
  }

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: env.OAUTH_CLIENT_ID,
      client_secret: env.OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${env.API_URL}/auth/callback`,
    }),
  });

  if (!tokenRes.ok) {
    return authErrorRedirect(env, 'Failed to exchange code for token');
  }

  const tokenData = await tokenRes.json();
  if (tokenData.error) {
    return authErrorRedirect(env, 'GitHub login failed — please try again');
  }

  // Get user info from GitHub
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'poly-convergence-bot',
    },
  });

  if (!userRes.ok) {
    return authErrorRedirect(env, 'Failed to get user info from GitHub');
  }

  const githubUser = await userRes.json();

  // Create or retrieve user record in KV (1 KV write for first-time users only)
  await getOrCreateUser(
    env.SUBMISSIONS_KV,
    String(githubUser.id),
    githubUser.login
  );

  // Create JWT session
  const jwt = await createJWT(
    {
      sub: String(githubUser.id),
      username: githubUser.login,
      avatar: githubUser.avatar_url,
      last_draft_save: null,
    },
    env.JWT_SECRET
  );

  const sessionCookie = createSessionCookie(jwt, env.COOKIE_DOMAIN);

  // Clear the OAuth state cookies
  const clearState = 'oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
  const clearReturn = 'oauth_return=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';

  // Redirect back to the site
  // SECURITY: Re-validate return path even from cookie (defense in depth)
  let returnTo = '/contribute';
  if (cookies.oauth_return) {
    const decoded = decodeURIComponent(cookies.oauth_return);
    if (decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes(':')) {
      returnTo = decoded;
    }
  }
  const redirectURL = `${env.SITE_URL}${returnTo}`;

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', redirectURL],
      ['Set-Cookie', sessionCookie],
      ['Set-Cookie', clearState],
      ['Set-Cookie', clearReturn],
    ],
  });
}

/**
 * POST /auth/logout
 * Clears the session cookie.
 */
export async function handleLogout(request, env) {
  const cookie = clearSessionCookie(env.COOKIE_DOMAIN);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookie,
    },
  });
}

/**
 * Redirect to the contribute page with an error message.
 * Used for OAuth callback errors so users see a friendly page instead of raw JSON.
 */
function authErrorRedirect(env, message) {
  const errorParam = encodeURIComponent(message);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${env.SITE_URL}/contribute?auth_error=${errorParam}`,
    },
  });
}

/**
 * Parse cookies from a request.
 */
function parseCookies(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const cookie of cookieHeader.split(';')) {
    const [name, ...valueParts] = cookie.trim().split('=');
    if (name) {
      cookies[name.trim()] = valueParts.join('=');
    }
  }
  return cookies;
}
