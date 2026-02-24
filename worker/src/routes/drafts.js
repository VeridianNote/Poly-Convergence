/**
 * Draft route handlers.
 *
 * GET  /api/drafts        → List user's drafts (branches)
 * GET  /api/draft         → Load a draft's content
 * POST /api/draft         → Save a draft (create branch + commit)
 * DELETE /api/draft       → Abandon a draft (delete branch, close PR)
 * GET  /api/content       → Load published content from main (for editing)
 * POST /api/merge         → Merge main into a user's draft branch
 */

import { requireAuth } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  createBranch,
  commitFile,
  getFileContent,
  listBranches,
  deleteBranch,
  deleteFile,
  getPRForBranch,
  closePR,
  mergeBranch,
  getCollaboratorPermission,
} from '../github/api.js';
import {
  validateContent,
  slugify,
  buildMarkdownFile,
  computeFilePath,
  validateCategory,
  validateBranch,
  validateContentPath,
} from '../utils/validation.js';
import {
  getOrCreateUser,
  getUserTier,
  loadConfig,
  checkSaveThrottle,
} from '../utils/rate-limit.js';
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

  // For each branch, check if there's an open PR.
  // Use per-branch try/catch so a transient GitHub error on one branch
  // doesn't crash the entire draft list.
  const drafts = await Promise.all(
    branches.map(async (branch) => {
      const slug = branch.name.replace(prefix, '');
      let pr = null;
      try {
        pr = await getPRForBranch(env, token, branch.name);
      } catch {
        // Transient GitHub error — show branch without PR info
      }

      return {
        slug,
        branch: branch.name,
        hasPR: !!pr,
        prNumber: pr?.number || null,
        prState: pr?.state || null,
        prUrl: pr?.html_url || null,
        prLabels: pr?.labels?.map(l => l.name) || [],
        prUpdatedAt: pr?.updated_at || null,
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
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
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
  // Filter out removed files — after a rename, old file is deleted and new is added.
  const contentFiles = compareData.files?.filter(
    f => f.status !== 'removed' &&
         (f.filename.startsWith('docs/') || f.filename.startsWith('blog/'))
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
 * GET /api/content?path=docs/category/page.md
 * Load published content from the main branch for editing.
 * For blog posts, enforces authorship check (only author or mod can edit).
 */
export async function handleLoadContent(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const path = url.searchParams.get('path');
  const pathCheck = validateContentPath(path);
  if (!pathCheck.valid) {
    return Response.json({ error: pathCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Load file from main branch
  const fileData = await getFileContent(env, token, 'main', path);
  if (!fileData) {
    return Response.json({ error: 'File not found' }, { status: 404 });
  }

  const { frontmatter, body } = parseFrontmatter(fileData.content);
  const type = path.startsWith('blog/') ? 'blog' : 'wiki';
  const category = type === 'wiki' ? extractCategory(path) : null;

  // Blog authorship check — only the author or a mod can edit blog posts
  if (type === 'blog') {
    const permission = await getCollaboratorPermission(env, token, user.username);
    const isMod = permission === 'admin' || permission === 'write';

    if (!isMod) {
      const authorsRaw = frontmatter.authors || '';
      const authorList = authorsRaw
        .replace(/[\[\]]/g, '')
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);

      // Block if authors field is missing (can't verify ownership) or user isn't listed
      if (authorList.length === 0 || !authorList.includes(user.username)) {
        return Response.json(
          { error: 'You can only edit your own blog posts.' },
          { status: 403 }
        );
      }
    }
  }

  return Response.json({
    path,
    title: frontmatter.title || '',
    body,
    type,
    category,
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
  const { title, body, type, category, subcategory, existingBranch, editPath } = requestBody;

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
    const branchCheck = validateBranch(existingBranch);
    if (!branchCheck.valid) {
      return Response.json({ error: branchCheck.error }, { status: 400 });
    }
    if (!isMod && !existingBranch.startsWith(`users/${user.username}/`)) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  // Validate editPath if provided (editing an existing published page)
  if (editPath) {
    const pathCheck = validateContentPath(editPath);
    if (!pathCheck.valid) {
      return Response.json({ error: pathCheck.error }, { status: 400 });
    }

    // Blog authorship check — only the author or a mod can edit blog posts.
    // Without this, a user could POST directly to /api/draft with another user's
    // blog editPath, bypassing the check in handleLoadContent.
    if (editPath.startsWith('blog/') && !isMod) {
      const existingFile = await getFileContent(env, token, 'main', editPath);
      if (!existingFile) {
        return Response.json({ error: 'Original blog post not found.' }, { status: 404 });
      }
      const { frontmatter } = parseFrontmatter(existingFile.content);
      const authorsRaw = frontmatter.authors || '';
      const authorList = authorsRaw
        .replace(/[\[\]]/g, '')
        .split(',')
        .map(a => a.trim())
        .filter(Boolean);

      if (authorList.length === 0 || !authorList.includes(user.username)) {
        return Response.json(
          { error: 'You can only edit your own blog posts.' },
          { status: 403 }
        );
      }
    }
  }

  // Validate category for wiki pages (skip when editing existing page — path is fixed)
  if (type === 'wiki' && !existingBranch && !editPath) {
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
  // existingBranch = updating a draft branch (find path from branch diff)
  // editPath = editing an existing published page (compute new path from slug + original directory)
  // otherwise = new draft (compute path from type/slug/category)
  let filePath;
  let oldFileToDelete = null; // Set when editPath rename is needed

  if (existingBranch) {
    filePath = await findContentFilePath(env, token, branchName);
  } else if (editPath) {
    // Compute the new path by replacing the filename with the new slug,
    // preserving the directory structure. This enables renaming pages.
    const dir = editPath.substring(0, editPath.lastIndexOf('/') + 1);
    const newPath = `${dir}${slug}.md`;
    filePath = newPath;
    // If the path changed (title was renamed), we need to delete the old file
    // after committing the new one.
    if (newPath !== editPath) {
      oldFileToDelete = editPath;
    }
  } else {
    filePath = computeFilePath(type, slug, category, subcategory);
  }

  if (!filePath) {
    // Clean up orphaned branch if we just created it
    if (!existingBranch) {
      await deleteBranch(env, token, branchName).catch(() => {});
    }
    return Response.json({ error: 'Could not determine file path' }, { status: 500 });
  }

  // Derive content type from file path when editing (don't trust client).
  // Only trust client type for brand-new drafts (no existingBranch and no editPath).
  const effectiveType = (existingBranch || editPath)
    ? (filePath.startsWith('blog/') ? 'blog' : 'wiki')
    : type;

  const fileContent = buildMarkdownFile({
    type: effectiveType,
    title,
    body,
    category,
    author: effectiveType === 'blog' ? user.username : undefined,
  });

  // For existing branches, check if content actually changed before committing.
  // The GitHub Contents API always creates a commit even if content is identical,
  // which clutters the history with empty "Update draft" commits.
  // Normalize line endings before comparing (GitHub stores LF, local may use CRLF).
  if (existingBranch) {
    const existingFile = await getFileContent(env, token, branchName, filePath);
    const normalize = s => s.replace(/\r\n/g, '\n');
    if (existingFile && normalize(existingFile.content) === normalize(fileContent)) {
      // No changes — return success without committing
      return new Response(
        JSON.stringify({
          ok: true,
          branch: branchName,
          filePath,
          slug,
          noChange: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

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

    // If this is a rename (editPath differs from new filePath), delete the old file.
    // This must happen AFTER the new file is committed so the branch is never empty.
    if (oldFileToDelete) {
      await deleteFile(env, token, branchName, oldFileToDelete, `Rename: ${oldFileToDelete} → ${filePath}`);
    }
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
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  // Security: users can only delete their own branches
  const token = await getInstallationToken(env);
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Close any open PR first (best-effort — don't block branch deletion)
  try {
    const pr = await getPRForBranch(env, token, branch);
    if (pr) {
      await closePR(env, token, pr.number);
    }
  } catch {
    // Transient GitHub error — proceed with branch deletion anyway.
    // Orphaned PRs pointing to deleted branches auto-close or are harmless.
  }

  // Delete the branch
  await deleteBranch(env, token, branch);

  return Response.json({ ok: true, deleted: branch });
}

/**
 * POST /api/merge
 * Merge main into a user's draft branch to bring it up to date.
 * Returns the published version of the content file on conflict
 * so the frontend can display it alongside the user's draft.
 */
export async function handleMergeBranch(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const { branch } = requestBody;
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Security: users can only merge into their own branches
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Attempt the merge
  const result = await mergeBranch(env, token, branch);

  if (result.merged) {
    return Response.json({ ok: true, merged: true, noChange: result.noChange || false });
  }

  if (result.conflict) {
    // Load the published (main) version of the content file so the user
    // can see what changed and manually reconcile.
    let publishedContent = null;

    try {
      const filePath = await findContentFilePath(env, token, branch);
      if (filePath) {
        const mainFile = await getFileContent(env, token, 'main', filePath);
        if (mainFile) {
          const { frontmatter, body } = parseFrontmatter(mainFile.content);
          publishedContent = {
            title: frontmatter.title || '',
            body,
          };
        }
      }
    } catch {
      // Couldn't load published content — still report the conflict
    }

    return Response.json({
      ok: false,
      conflict: true,
      publishedContent,
      message: 'Merge conflict detected. Review the published version and update your draft manually.',
    });
  }

  return Response.json({ error: 'Unexpected merge result' }, { status: 500 });
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
  // Filter out removed files — after a rename, the old file is deleted and
  // the new file is added. We want the added/modified file, not the removed one.
  const contentFile = data.files?.find(
    f => f.status !== 'removed' &&
         (f.filename.startsWith('docs/') || f.filename.startsWith('blog/'))
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
