/**
 * Reactions API — lightweight engagement counters.
 *
 * No authentication required. Client-side localStorage prevents
 * duplicate clicks. D1 stores aggregate counts per slug.
 *
 * Endpoints:
 *   GET  /api/reactions?slug=...       → Get counts for one page
 *   GET  /api/reactions/batch?slugs=.. → Get counts for multiple pages (homepage)
 *   POST /api/reactions                → Increment a counter
 */

/**
 * Validate a slug: must be a URL-safe path like /blog/my-post or /docs/category/page
 */
function isValidSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  if (slug.length > 300) return false;
  // Must start with / and only contain URL-safe characters
  return /^\/[a-zA-Z0-9\-_/]+$/.test(slug);
}

/**
 * GET /api/reactions?slug=/blog/my-post
 * Returns { slug, likes, shares } for a single page.
 */
export async function handleGetReactions(request, env) {
  const url = new URL(request.url);
  const slug = url.searchParams.get('slug');

  if (!isValidSlug(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 });
  }

  const row = await env.REACTIONS_DB.prepare(
    'SELECT slug, likes, shares FROM reactions WHERE slug = ?'
  ).bind(slug).first();

  return Response.json({
    slug,
    likes: row?.likes || 0,
    shares: row?.shares || 0,
  });
}

/**
 * GET /api/reactions/batch?slugs=/blog/a,/blog/b,/docs/c
 * Returns { counts: { "/blog/a": { likes, shares }, ... } }
 * Used by the homepage to show engagement on preview cards.
 */
export async function handleGetReactionsBatch(request, env) {
  const url = new URL(request.url);
  const slugsParam = url.searchParams.get('slugs');

  if (!slugsParam) {
    return Response.json({ error: 'Missing slugs parameter' }, { status: 400 });
  }

  const slugs = slugsParam.split(',').filter(isValidSlug);

  if (slugs.length === 0) {
    return Response.json({ counts: {} });
  }

  // Cap at 50 slugs per request
  if (slugs.length > 50) {
    return Response.json({ error: 'Too many slugs (max 50)' }, { status: 400 });
  }

  // Build parameterized query
  const placeholders = slugs.map(() => '?').join(',');
  const { results } = await env.REACTIONS_DB.prepare(
    `SELECT slug, likes, shares FROM reactions WHERE slug IN (${placeholders})`
  ).bind(...slugs).all();

  const counts = {};
  for (const row of results) {
    counts[row.slug] = { likes: row.likes, shares: row.shares };
  }

  // Fill in zeros for slugs not in DB
  for (const slug of slugs) {
    if (!counts[slug]) {
      counts[slug] = { likes: 0, shares: 0 };
    }
  }

  return Response.json({ counts });
}

/**
 * POST /api/reactions
 * Body: { slug: "/blog/my-post", type: "like" | "share" }
 * Increments the counter by 1. Returns updated counts.
 */
export async function handlePostReaction(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { slug, type } = body;

  if (!isValidSlug(slug)) {
    return Response.json({ error: 'Invalid slug' }, { status: 400 });
  }

  if (type !== 'like' && type !== 'share') {
    return Response.json({ error: 'Type must be "like" or "share"' }, { status: 400 });
  }

  const column = type === 'like' ? 'likes' : 'shares';

  // Upsert: insert if not exists, otherwise increment
  await env.REACTIONS_DB.prepare(`
    INSERT INTO reactions (slug, ${column}, created_at, updated_at)
    VALUES (?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(slug) DO UPDATE SET
      ${column} = ${column} + 1,
      updated_at = datetime('now')
  `).bind(slug).run();

  // Return updated counts
  const row = await env.REACTIONS_DB.prepare(
    'SELECT likes, shares FROM reactions WHERE slug = ?'
  ).bind(slug).first();

  return Response.json({
    slug,
    likes: row?.likes || 0,
    shares: row?.shares || 0,
  });
}
