/**
 * Author profile route handlers.
 *
 * GET /api/author  → Get current user's author profile (from D1)
 * PUT /api/author  → Create or update author profile
 *
 * Author profiles are stored in D1 and used to populate authors.yml
 * entries when submitting stories for review.
 */

import { requireAuth } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import { getCollaboratorPermission } from '../github/api.js';

/**
 * GET /api/author
 * Returns the authenticated user's author profile.
 * If no profile exists in D1, returns sensible defaults.
 */
export async function handleGetAuthorProfile(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const row = await env.REACTIONS_DB
    .prepare('SELECT * FROM authors WHERE github_username = ?')
    .bind(user.username)
    .first();

  if (row) {
    return Response.json({
      profile: {
        github_username: row.github_username,
        display_name: row.display_name,
        title: row.title,
        url: row.url || '',
        image_url: `https://github.com/${row.github_username}.png`,
      },
    });
  }

  // No profile yet — return defaults
  return Response.json({
    profile: {
      github_username: user.username,
      display_name: user.username,
      title: 'Community Contributor',
      url: '',
      image_url: `https://github.com/${user.username}.png`,
    },
  });
}

/**
 * PUT /api/author
 * Create or update the authenticated user's author profile.
 *
 * Body: { display_name: string, title?: string, url?: string }
 *
 * Non-mods always get title = "Community Contributor" regardless of input.
 */
export async function handleSaveAuthorProfile(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { display_name, title, url } = body;

  // --- Validate display_name ---
  if (!display_name || typeof display_name !== 'string') {
    return Response.json(
      { error: 'Display name is required.' },
      { status: 400 }
    );
  }

  const trimmedName = display_name.trim();
  if (trimmedName.length < 1 || trimmedName.length > 100) {
    return Response.json(
      { error: 'Display name must be 1-100 characters.' },
      { status: 400 }
    );
  }

  // Reject names that are only special characters / whitespace abuse
  if (!/[a-zA-Z0-9]/.test(trimmedName)) {
    return Response.json(
      { error: 'Display name must contain at least one letter or number.' },
      { status: 400 }
    );
  }

  // --- Validate URL ---
  let trimmedUrl = '';
  if (url && typeof url === 'string') {
    trimmedUrl = url.trim();
    if (trimmedUrl.length > 500) {
      return Response.json(
        { error: 'URL must be 500 characters or fewer.' },
        { status: 400 }
      );
    }
    if (trimmedUrl && !trimmedUrl.match(/^https?:\/\//i)) {
      return Response.json(
        { error: 'URL must start with http:// or https://' },
        { status: 400 }
      );
    }
    // Block javascript: and data: protocols (defense in depth)
    if (/^(javascript|data|vbscript):/i.test(trimmedUrl)) {
      return Response.json(
        { error: 'Invalid URL protocol.' },
        { status: 400 }
      );
    }
  }

  // --- Determine title ---
  // Non-mods always get "Community Contributor" to prevent self-promotion
  const token = await getInstallationToken(env);
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  let finalTitle = 'Community Contributor';
  if (isMod && title && typeof title === 'string') {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 0 && trimmedTitle.length <= 100) {
      finalTitle = trimmedTitle;
    }
  }

  // --- Upsert to D1 ---
  await env.REACTIONS_DB
    .prepare(`
      INSERT INTO authors (github_username, display_name, title, url, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(github_username) DO UPDATE SET
        display_name = excluded.display_name,
        title = excluded.title,
        url = excluded.url,
        updated_at = datetime('now')
    `)
    .bind(user.username, trimmedName, finalTitle, trimmedUrl || null)
    .run();

  return Response.json({
    ok: true,
    profile: {
      github_username: user.username,
      display_name: trimmedName,
      title: finalTitle,
      url: trimmedUrl,
      image_url: `https://github.com/${user.username}.png`,
    },
  });
}
