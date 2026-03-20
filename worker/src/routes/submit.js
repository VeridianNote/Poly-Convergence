/**
 * Submission route handlers.
 *
 * POST /api/submit   → Create/update a PR for review
 * GET  /api/status   → Check PR status, labels, conflicts
 */

import { requireAuth } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  createPullRequest,
  getPRForBranch,
  getCollaboratorPermission,
  getFileContent,
  commitFile,
} from '../github/api.js';
import { getOrCreateUser, getUserTier, loadConfig } from '../utils/rate-limit.js';
import { validateBranch } from '../utils/validation.js';

/**
 * POST /api/submit
 * Submit a draft for review — creates a PR from the user's branch.
 */
export async function handleSubmit(request, env) {
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

  // Check kill switch
  const config = await loadConfig(env.SUBMISSIONS_KV);
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!config.submissions_enabled && !isMod) {
    return Response.json(
      { error: 'Community submissions are temporarily paused.', code: 'SUBMISSIONS_DISABLED' },
      { status: 503 }
    );
  }

  // Security: users can only submit their own branches
  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Check if a PR already exists for this branch
  const existingPR = await getPRForBranch(env, token, branch);
  if (existingPR) {
    return Response.json({
      ok: true,
      pr: {
        number: existingPR.number,
        url: existingPR.html_url,
        state: existingPR.state,
        labels: existingPR.labels?.map(l => l.name) || [],
      },
      message: 'PR already exists. Your latest changes are automatically reflected.',
    });
  }

  // Determine content type from the branch files
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
    return Response.json(
      { error: 'Failed to compare branch with main' },
      { status: 500 }
    );
  }

  const compareData = await compareRes.json();
  const contentFiles = compareData.files?.filter(
    f => f.filename.startsWith('wiki/') || f.filename.startsWith('stories/')
  ) || [];

  if (contentFiles.length === 0) {
    return Response.json(
      { error: 'No content files found in your draft' },
      { status: 400 }
    );
  }

  const isWiki = contentFiles[0].filename.startsWith('wiki/');
  const isStory = contentFiles[0].filename.startsWith('stories/');
  const contentType = isWiki ? 'Wiki' : 'Story';

  // Get user record for trust tier info
  const userRecord = await getOrCreateUser(env.SUBMISSIONS_KV, user.sub, user.username);
  const tier = getUserTier(userRecord, isMod, config);

  // Build PR title and body
  const slug = branch.split('/').pop();
  const prTitle = `[${contentType}] ${slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;

  // Check for unresolved {{image:N}} placeholders and image comment placeholders
  const hasImageComments = contentFiles.some(f =>
    f.patch?.includes('<!-- image:')
  );
  const hasUnresolvedImageTags = contentFiles.some(f =>
    f.patch && /\{\{image:\d+/i.test(f.patch)
  );

  const prBody = buildPRBody({
    username: user.username,
    contentType,
    tier: tier.tier,
    mergedCount: userRecord.merged_count,
    files: contentFiles.map(f => f.filename),
    hasImagePlaceholders: hasImageComments,
    hasUnresolvedImageTags,
    isMod,
  });

  // Auto-labels
  const labels = ['community-submission'];
  if (isWiki) labels.push('wiki');
  if (isStory) labels.push('story');
  if (userRecord.merged_count === 0) labels.push('new-contributor');

  // For stories: ensure the author has an entry in authors.yml
  if (isStory) {
    try {
      await ensureAuthorInYml(env, token, branch, user.username);
    } catch (err) {
      // Non-fatal — the PR can still be created without the authors.yml update.
      // The mod can add it manually during review if needed.
      console.error('Failed to update authors.yml:', err.message);
    }
  }

  // Create the PR
  const pr = await createPullRequest(env, token, {
    title: prTitle,
    body: prBody,
    head: branch,
    base: 'main',
    labels,
  });

  return Response.json({
    ok: true,
    pr: {
      number: pr.number,
      url: pr.html_url,
      state: pr.state,
      labels: pr.labels?.map(l => l.name) || [],
    },
  });
}

/**
 * GET /api/status?branch=users/octocat/my-page
 * Check the status of a draft's PR.
 */
export async function handleStatus(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Security: users can only check their own branches (mods can check any)
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Check if there's a PR for this branch
  const pr = await getPRForBranch(env, token, branch);

  // Check if branch is behind main
  let behindMain = false;
  let conflicting = false;

  try {
    const compareRes = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/compare/${branch}...main`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'poly-convergence-bot',
        },
      }
    );

    if (compareRes.ok) {
      const data = await compareRes.json();
      if (data.ahead_by > 0) {
        // Only flag if the specific page being edited was modified on main.
        // Branch format: users/{username}/{slug} → the slug comes from slugify()
        // (max 60 chars) and is used identically for both the branch name and
        // the content filename, so exact match is safe.
        const slug = branch.split('/').pop();
        const changedFiles = (data.files || []).map(f => f.filename);
        behindMain = changedFiles.some(f => {
          const basename = f.split('/').pop().replace(/\.md$/, '');
          // Strip date prefix for stories (YYYY-MM-DD-)
          const withoutDate = basename.replace(/^\d{4}-\d{2}-\d{2}-/, '');
          return basename === slug || withoutDate === slug;
        });
      }
    }
  } catch {
    // Non-critical, just can't determine merge status
  }

  // Check mergeability if PR exists
  if (pr && pr.mergeable === false) {
    conflicting = true;
  }

  return Response.json({
    branch,
    pr: pr ? {
      number: pr.number,
      state: pr.state,
      url: pr.html_url,
      labels: pr.labels?.map(l => l.name) || [],
      mergeable: pr.mergeable,
      reviewComments: pr.review_comments,
      comments: pr.comments,
      updatedAt: pr.updated_at,
      changesRequested: pr.labels?.some(l => l.name === 'needs-revision') || false,
    } : null,
    behindMain,
    conflicting,
  });
}

/**
 * Build the PR description body.
 */
function buildPRBody({ username, contentType, tier, mergedCount, files, hasImagePlaceholders, hasUnresolvedImageTags, isMod }) {
  const lines = [
    `## Community Submission`,
    '',
    `**Contributor:** @${username}`,
    `**Content type:** ${contentType}`,
    `**Trust tier:** ${tier} (${mergedCount} merged PRs)`,
    '',
    `### Files`,
    ...files.map(f => `- \`${f}\``),
    '',
  ];

  if (hasImagePlaceholders) {
    lines.push(
      '### Image Placeholders',
      'This submission contains image placeholder comments (`<!-- image: ... -->`). '
      + 'To allow the contributor to upload images, apply the `images-approved` label.',
      ''
    );
  }

  if (hasUnresolvedImageTags) {
    lines.push(
      '### Unresolved Image References',
      'This submission contains `{{image:N}}` placeholders that were not resolved to uploaded images. '
      + 'The contributor may need to upload images and re-save their draft.',
      ''
    );
  }

  // Security review checklist for non-mod submissions
  if (!isMod) {
    lines.push(
      '### Review Checklist',
      '- [ ] Content is appropriate and follows community guidelines',
      '- [ ] No suspicious HTML or external resource references',
      '- [ ] Image sources are internal (`/img/` paths only)',
      ''
    );
  }

  lines.push(
    '---',
    '*Submitted via the [Poly Convergence](https://polyconvergence.com) contribution system.*',
  );

  return lines.join('\n');
}

/**
 * Ensure the submitting user has an entry in stories/authors.yml.
 * If they don't, read their D1 profile (or use defaults) and commit
 * an updated authors.yml to their branch before the PR is created.
 *
 * @param {Object} env - Worker env bindings
 * @param {string} token - GitHub installation token
 * @param {string} branch - The user's draft branch
 * @param {string} username - GitHub username
 */
async function ensureAuthorInYml(env, token, branch, username) {
  // Read current authors.yml from main
  let authorsContent;
  try {
    authorsContent = await getFileContent(env, token, 'main', 'stories/authors.yml');
  } catch {
    // File doesn't exist yet — start fresh
    authorsContent = '';
  }

  // Check if this username already has an entry (top-level YAML key)
  const keyRegex = new RegExp(`^${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`, 'mi');
  if (keyRegex.test(authorsContent)) {
    return; // Already exists — nothing to do
  }

  // Read author profile from D1
  const row = await env.REACTIONS_DB
    .prepare('SELECT * FROM authors WHERE github_username = ?')
    .bind(username)
    .first();

  const displayName = row?.display_name || username;
  const title = row?.title || 'Community Contributor';
  const url = row?.url || '';
  const imageUrl = `https://github.com/${username}.png`;

  // Build the new YAML entry
  // Escape any quotes in display_name/title for safety
  const safeName = displayName.replace(/"/g, '\\"');
  const safeTitle = title.replace(/"/g, '\\"');

  const lines = [
    '',
    `${username}:`,
    `  name: "${safeName}"`,
    `  title: "${safeTitle}"`,
  ];
  if (url) {
    lines.push(`  url: ${url}`);
  }
  lines.push(`  image_url: ${imageUrl}`);

  const updatedContent = authorsContent.trimEnd() + '\n' + lines.join('\n') + '\n';

  // Commit to the user's branch
  await commitFile(
    env, token, branch,
    'stories/authors.yml',
    updatedContent,
    `Add author profile for ${username}`
  );
}
