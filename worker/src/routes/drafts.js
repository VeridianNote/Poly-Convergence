/**
 * Draft route handlers.
 *
 * GET  /api/drafts        → List user's drafts (branches)
 * GET  /api/draft/:slug   → Load a draft's content
 * POST /api/draft         → Save a draft (create branch + commit)
 * DELETE /api/draft/:slug → Abandon a draft (delete branch, close PR)
 */

import { requireAuth } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  createBranch,
  commitFile,
  getFileContent,
  listBranches,
  deleteBranch,
  getPRForBranch,
  closePR,
} from '../github/api.js';
import {
  validateContent,
  slugify,
  buildMarkdownFile,
  computeFilePath,
  validateCategory,
} from '../utils/validation.js';
import {
  getOrCreateUser,
  getUserTier,
  loadConfig,
  checkSaveThrottle,
} from '../utils/rate-limit.js';
import { getCollaboratorPermission } from '../github/api.js';
import { createJWT, createSessionCookie } from '../utils/jwt.js';

/**
 * GET /api/drafts
 * List the current user's draft branches and their status.
 */
export async function handleListDrafts(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const token = await getInstallationToken(env);
  const prefix = `users/${user.username}/`;
  const branches = await listBranches(env, token, prefix);

  // For each branch, check if there's an open PR
  const drafts = await Promise.all(
    branches.map(async (branch) => {
      const slug = branch.name.replace(prefix, '');
      const pr = await getPRForBranch(env, token, branch.name);

      return {
        slug,
        branch: branch.name,
        hasPR: !!pr,
        prNumber: pr?.number || null,
        prState: pr?.state || null,
        prUrl: pr?.html_url || null,
        prLabels: pr?.labels?.map(l => l.name) || [],
      };
    })
  );

  return Response.json({ drafts });
}

/**
 * GET /api/draft?branch=users/octocat/my-page
 * Load a specific draft's content.
 */
export async function handleLoadDraft(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');
  if (!branch) {
    return Response.json({ error: 'Missing branch parameter' }, { status: 400 });
  }

  // Security: users can only load their own branches (mods can load any)
  const token = await getInstallationToken(env);
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Find the content file on this branch
  // We need to figure out which file was committed — check PR or branch diff
  const pr = await getPRForBranch(env, token, branch);

  // List files changed in this branch vs main
  const compareRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/compare/main...${branch}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'poly-convergence-bot',
      },
    }
  );

  if (!compareRes.ok) {
    const status = compareRes.status;
    if (status === 404) {
      return Response.json(
        { error: 'This draft no longer exists. It may have been merged or deleted.' },
        { status: 404 }
      );
    }
    return Response.json({ error: 'Failed to load draft' }, { status: 500 });
  }

  const compareData = await compareRes.json();
  const contentFiles = compareData.files?.filter(
    f => f.filename.startsWith('docs/') || f.filename.startsWith('blog/')
  ) || [];

  if (contentFiles.length === 0) {
    return Response.json({ error: 'No content files found in draft' }, { status: 404 });
  }

  // Load the primary content file
  const filePath = contentFiles[0].filename;
  const fileData = await getFileContent(env, token, branch, filePath);

  if (!fileData) {
    return Response.json({ error: 'Content file not found' }, { status: 404 });
  }

  // Parse frontmatter
  const { frontmatter, body } = parseFrontmatter(fileData.content);

  return Response.json({
    branch,
    filePath,
    title: frontmatter.title || '',
    body,
    type: filePath.startsWith('blog/') ? 'blog' : 'wiki',
    category: extractCategory(filePath),
    pr: pr ? {
      number: pr.number,
      state: pr.state,
      url: pr.html_url,
      labels: pr.labels?.map(l => l.name) || [],
      reviewComments: pr.review_comments,
    } : null,
  });
}

/**
 * POST /api/draft
 * Save a draft — creates branch + commits file.
 * If branch already exists, commits an update.
 */
export async function handleSaveDraft(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  // Check kill switch
  const config = await loadConfig(env.SUBMISSIONS_KV);
  const token = await getInstallationToken(env);

  // Check if user is a mod
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!config.submissions_enabled && !isMod) {
    return Response.json(
      { error: 'Community submissions are temporarily paused.', code: 'SUBMISSIONS_DISABLED' },
      { status: 503 }
    );
  }

  // Parse request body
  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const { title, body, type, category, subcategory, existingBranch } = requestBody;

  // Validate content type
  if (type !== 'wiki' && type !== 'blog') {
    return Response.json(
      { error: 'Content type must be "wiki" or "blog".' },
      { status: 400 }
    );
  }

  // Validate content
  const validation = validateContent(title, body);
  if (!validation.valid) {
    return Response.json(
      { error: 'Validation failed', errors: validation.errors },
      { status: 400 }
    );
  }

  // SECURITY: Validate existingBranch format and ownership
  if (existingBranch) {
    // Must match users/<username>/<slug> format — no path traversal, no extra slashes
    const branchPattern = /^users\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;
    if (!branchPattern.test(existingBranch)) {
      return Response.json({ error: 'Invalid branch name format' }, { status: 400 });
    }
    if (!isMod && !existingBranch.startsWith(`users/${user.username}/`)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // Validate category for wiki pages
  if (type === 'wiki' && !existingBranch) {
    const catValidation = validateCategory(category);
    if (!catValidation.valid) {
      return Response.json(
        { error: catValidation.error },
        { status: 400 }
      );
    }
  }

  // Validate subcategory if provided (prevent path traversal)
  if (subcategory) {
    const subCatValidation = validateCategory(subcategory);
    if (!subCatValidation.valid) {
      return Response.json(
        { error: `Invalid subcategory: ${subCatValidation.error}` },
        { status: 400 }
      );
    }
  }

  // Check draft save throttle (from JWT, not KV)
  if (!isMod) {
    const throttle = checkSaveThrottle(
      user.last_draft_save,
      config.draft_save_interval
    );
    if (!throttle.allowed) {
      return Response.json(
        {
          error: `Please wait ${throttle.waitSeconds} seconds before saving again.`,
          code: 'THROTTLED',
          waitSeconds: throttle.waitSeconds,
        },
        { status: 429 }
      );
    }
  }

  // Get user record for rate limit checks
  const userRecord = await getOrCreateUser(env.SUBMISSIONS_KV, user.sub, user.username);
  const tier = getUserTier(userRecord, isMod, config);

  // Determine branch name
  const slug = slugify(title);
  if (!slug) {
    return Response.json(
      { error: 'Title must contain at least some alphanumeric characters.' },
      { status: 400 }
    );
  }
  const branchName = existingBranch || `users/${user.username}/${slug}`;

  // If creating a new branch, check pending limit
  if (!existingBranch) {
    const existingBranches = await listBranches(env, token, `users/${user.username}/`);
    const pendingCount = existingBranches.length;

    if (pendingCount >= tier.maxPending) {
      return Response.json(
        {
          error: `You can have at most ${tier.maxPending} pending edit(s). Finish or abandon an existing draft first.`,
          code: 'PENDING_LIMIT',
          maxPending: tier.maxPending,
          currentPending: pendingCount,
        },
        { status: 429 }
      );
    }

    // Create the branch
    const branchResult = await createBranch(env, token, branchName);
    if (branchResult.exists) {
      // A branch with this slug already exists for this user.
      // This means they have a previous draft with the same title.
      // Don't silently overwrite — tell them to use the existing draft.
      return Response.json(
        {
          error: 'You already have a draft with this title. Open it from your drafts list to continue editing.',
          code: 'BRANCH_EXISTS',
        },
        { status: 409 }
      );
    }
  }

  // Build the file content
  const filePath = existingBranch
    ? await findContentFilePath(env, token, branchName)
    : computeFilePath(type, slug, category, subcategory);

  if (!filePath) {
    // Clean up orphaned branch if we just created it
    if (!existingBranch) {
      await deleteBranch(env, token, branchName).catch(() => {});
    }
    return Response.json({ error: 'Could not determine file path' }, { status: 500 });
  }

  // For existing branches, derive content type from file path (don't trust client)
  const effectiveType = existingBranch
    ? (filePath.startsWith('blog/') ? 'blog' : 'wiki')
    : type;

  const fileContent = buildMarkdownFile({
    type: effectiveType,
    title,
    body,
    category,
    author: effectiveType === 'blog' ? user.username : undefined,
  });

  // Commit file(s) to the branch — clean up orphaned branch on failure
  try {
    // Handle new subcategory creation
    if (type === 'wiki' && subcategory && !existingBranch) {
      // Create _category_.json for the new subcategory
      const categoryJson = JSON.stringify({
        label: subcategory.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        position: 99,
        collapsed: true,
      }, null, 2);

      await commitFile(
        env, token, branchName,
        `docs/${category}/${subcategory}/_category_.json`,
        categoryJson,
        `Add new subcategory: ${subcategory}`
      );
    }

    // Commit the content file
    const commitMessage = existingBranch
      ? `Update draft: ${title}`
      : `Add draft: ${title}`;

    await commitFile(env, token, branchName, filePath, fileContent, commitMessage);
  } catch (err) {
    // Clean up orphaned branch if we just created it and commit failed
    if (!existingBranch) {
      await deleteBranch(env, token, branchName).catch(() => {});
    }
    throw err;
  }

  // Issue a new JWT with updated last_draft_save timestamp
  const newJWT = await createJWT(
    {
      sub: user.sub,
      username: user.username,
      avatar: user.avatar,
      last_draft_save: new Date().toISOString(),
    },
    env.JWT_SECRET
  );

  const sessionCookie = createSessionCookie(newJWT, env.COOKIE_DOMAIN);

  return new Response(
    JSON.stringify({
      ok: true,
      branch: branchName,
      filePath,
      slug,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie,
      },
    }
  );
}

/**
 * DELETE /api/draft?branch=users/octocat/my-page
 * Abandon a draft — delete branch and close any PR.
 */
export async function handleAbandonDraft(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');
  if (!branch) {
    return Response.json({ error: 'Missing branch parameter' }, { status: 400 });
  }

  // Security: users can only delete their own branches
  const token = await getInstallationToken(env);
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Close any open PR first
  const pr = await getPRForBranch(env, token, branch);
  if (pr) {
    await closePR(env, token, pr.number);
  }

  // Delete the branch
  await deleteBranch(env, token, branch);

  return Response.json({ ok: true, deleted: branch });
}

/**
 * Find the content file path on an existing branch (by comparing to main).
 */
async function findContentFilePath(env, token, branch) {
  const compareRes = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/compare/main...${branch}`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'poly-convergence-bot',
      },
    }
  );

  if (!compareRes.ok) return null;

  const data = await compareRes.json();
  const contentFile = data.files?.find(
    f => f.filename.startsWith('docs/') || f.filename.startsWith('blog/')
  );

  return contentFile?.filename || null;
}

/**
 * Parse frontmatter from a markdown string.
 */
function parseFrontmatter(content) {
  // Normalize CRLF → LF for consistent parsing (handles files edited on Windows)
  const normalized = content.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterStr = match[1];
  const body = match[2];

  // Simple YAML-ish parsing (good enough for our frontmatter)
  const frontmatter = {};
  for (const line of frontmatterStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      let value = line.substring(colonIdx + 1).trim();
      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Extract wiki category from a file path.
 * e.g., "docs/foundational-concepts/my-page.md" → "foundational-concepts"
 */
function extractCategory(filePath) {
  if (!filePath.startsWith('docs/')) return null;
  const parts = filePath.replace('docs/', '').split('/');
  return parts.length > 1 ? parts[0] : null;
}
