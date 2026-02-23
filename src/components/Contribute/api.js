/**
 * API client for the Poly Convergence Worker.
 *
 * All requests include credentials (cookies) for JWT session auth.
 * Handles 401 responses by saving editor state and redirecting to re-auth.
 */

// API URL — hardcoded for production. For local development,
// set window.__POLY_API_URL before loading (see contribute.js).
function getApiUrl() {
  if (typeof window !== 'undefined' && window.__POLY_API_URL) {
    return window.__POLY_API_URL;
  }
  return 'https://api.polyconvergence.com';
}

/**
 * Make an authenticated API request.
 * Automatically handles 401 by triggering re-auth flow.
 */
async function apiFetch(path, options = {}) {
  const url = `${getApiUrl()}${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: 'include', // Send cookies
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  // Handle expired JWT — save state and re-auth
  if (res.status === 401) {
    // handleExpiredSession() either redirects (and never returns due to page unload)
    // or throws if a redirect loop is detected. Either way, we don't reach the
    // throw below — but it's here as a safety net in case the redirect is slow.
    handleExpiredSession();
    // Await a long delay so the redirect completes before any error UI flashes
    await new Promise(resolve => setTimeout(resolve, 5000));
    throw new Error('Session expired');
  }

  return res;
}

/**
 * Handle an expired session by saving editor state and redirecting to login.
 * Includes a redirect loop guard — if we redirected to login less than 2 minutes ago,
 * show an error instead of redirecting again (prevents infinite loops from persistent 401s).
 */
function handleExpiredSession() {
  // Redirect loop guard
  const lastRedirect = localStorage.getItem('poly_auth_redirect_at');
  if (lastRedirect) {
    const elapsed = Date.now() - Number(lastRedirect);
    if (elapsed < 120_000) { // 2 minutes
      // Don't redirect — we just came back from login and still got 401
      localStorage.removeItem('poly_auth_redirect_at');
      // Surface the error so the UI can display it
      throw new Error(
        'Your session could not be restored after re-login. '
        + 'Please clear your cookies and try signing in again.'
      );
    }
  }

  // Save current editor state to localStorage before redirect
  const editorState = {
    title: window.__editorTitle || document.querySelector('[data-editor-title]')?.value || '',
    body: window.__editorContent || '',
    type: window.__editorType || 'wiki',
    category: window.__editorCategory || '',
    branch: window.__editorBranch || '',
    savedAt: new Date().toISOString(),
  };

  localStorage.setItem('poly_editor_recovery', JSON.stringify(editorState));
  localStorage.setItem('poly_auth_redirect_at', String(Date.now()));

  // Redirect to OAuth login with return URL
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `${getApiUrl()}/auth/login?return_to=${returnTo}`;
}

/**
 * Check for and restore saved editor state after re-auth.
 * Returns the saved state or null.
 */
export function checkEditorRecovery() {
  try {
    const saved = localStorage.getItem('poly_editor_recovery');
    if (!saved) return null;

    const state = JSON.parse(saved);
    // Only restore if saved within the last 10 minutes
    const savedAt = new Date(state.savedAt).getTime();
    if (Date.now() - savedAt > 10 * 60 * 1000) {
      localStorage.removeItem('poly_editor_recovery');
      return null;
    }

    // Clear recovery state after reading
    localStorage.removeItem('poly_editor_recovery');
    return state;
  } catch {
    localStorage.removeItem('poly_editor_recovery');
    return null;
  }
}

// --- API Methods ---

/**
 * Get current user info and trust tier.
 */
export async function getUser() {
  const res = await apiFetch('/api/user');
  const data = await res.json();
  return data.user;
}

/**
 * Get public config (submissions enabled, etc.).
 */
export async function getConfig() {
  const res = await apiFetch('/api/config');
  return res.json();
}

/**
 * Get wiki categories.
 */
export async function getCategories() {
  const res = await apiFetch('/api/categories');
  const data = await res.json();
  return data.categories;
}

/**
 * List the user's drafts.
 */
export async function listDrafts() {
  const res = await apiFetch('/api/drafts');
  const data = await res.json();
  return data.drafts;
}

/**
 * Load a specific draft's content.
 */
export async function loadDraft(branch) {
  const res = await apiFetch(`/api/draft?branch=${encodeURIComponent(branch)}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to load draft');
  }
  return res.json();
}

/**
 * Save a draft (create or update).
 */
export async function saveDraft({ title, body, type, category, subcategory, existingBranch }) {
  const res = await apiFetch('/api/draft', {
    method: 'POST',
    body: JSON.stringify({ title, body, type, category, subcategory, existingBranch }),
  });

  const data = await res.json();

  if (!res.ok) {
    return { ok: false, ...data };
  }

  return { ok: true, ...data };
}

/**
 * Submit a draft for review (create PR).
 */
export async function submitForReview(branch) {
  const res = await apiFetch('/api/submit', {
    method: 'POST',
    body: JSON.stringify({ branch }),
  });

  const data = await res.json();
  if (!res.ok) {
    return { ok: false, ...data };
  }
  return { ok: true, ...data };
}

/**
 * Abandon a draft (delete branch + close PR).
 */
export async function abandonDraft(branch) {
  const res = await apiFetch(`/api/draft?branch=${encodeURIComponent(branch)}`, {
    method: 'DELETE',
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to abandon draft');
  }
  return data;
}

/**
 * Check PR status for a draft.
 */
export async function getStatus(branch) {
  const res = await apiFetch(`/api/status?branch=${encodeURIComponent(branch)}`);
  return res.json();
}

/**
 * Logout (clear session).
 */
export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  window.location.reload();
}

/**
 * Get the login URL.
 */
export function getLoginUrl(returnTo = '/contribute') {
  return `${getApiUrl()}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
}
