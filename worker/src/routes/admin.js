/**
 * Admin route handlers (mod-only).
 *
 * GET    /api/admin/users          → List active contributors
 * POST   /api/admin/approve-images → Approve a user for image uploads
 * POST   /api/admin/config         → Update system config
 * DELETE /api/admin/branch         → Force-delete a user's branch
 */

import { requireAuth, requireMod } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  listBranches,
  deleteBranch,
  getPRForBranch,
  closePR,
  getLastCommitDate,
} from '../github/api.js';

/**
 * GET /api/admin/users
 * List active contributors with their branches, trust tier, and activity.
 */
export async function handleAdminListUsers(request, env) {
  const { user, response: authRes } = await requireAuth(request, env);
  if (authRes) return authRes;

  const { isMod, response: modRes } = await requireMod(user, env, getInstallationToken);
  if (modRes) return modRes;

  const token = await getInstallationToken(env);

  // List all user branches
  const branches = await listBranches(env, token, 'users/');

  // Group by username
  const userMap = {};
  for (const branch of branches) {
    const username = branch.name.split('/')[1];
    if (!userMap[username]) {
      userMap[username] = [];
    }
    userMap[username].push(branch.name);
  }

  // Get KV records for each user
  const users = [];
  const kvList = await env.SUBMISSIONS_KV.list({ prefix: 'user:' });

  for (const key of kvList.keys) {
    const record = await env.SUBMISSIONS_KV.get(key.name);
    if (!record) continue;

    const data = JSON.parse(record);
    const userBranches = userMap[data.username] || [];

    // Get last activity for each branch
    const branchDetails = await Promise.all(
      userBranches.map(async (branchName) => {
        const lastCommit = await getLastCommitDate(env, token, branchName);
        const pr = await getPRForBranch(env, token, branchName);
        return {
          branch: branchName,
          lastActivity: lastCommit?.toISOString() || null,
          hasPR: !!pr,
          prNumber: pr?.number || null,
          prUrl: pr?.html_url || null,
        };
      })
    );

    users.push({
      kvKey: key.name,
      username: data.username,
      mergedCount: data.merged_count || 0,
      imageApproved: data.image_approved || false,
      createdAt: data.created_at,
      activeBranches: branchDetails,
    });
  }

  return Response.json({ users });
}

/**
 * POST /api/admin/approve-images
 * Toggle image upload approval for a user.
 * Body: { githubId: "12345", approved: true }
 */
export async function handleAdminApproveImages(request, env) {
  const { user, response: authRes } = await requireAuth(request, env);
  if (authRes) return authRes;

  const { isMod, response: modRes } = await requireMod(user, env, getInstallationToken);
  if (modRes) return modRes;

  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const { githubId, approved } = requestBody;
  if (!githubId || typeof approved !== 'boolean') {
    return Response.json(
      { error: 'Missing githubId or approved parameter' },
      { status: 400 }
    );
  }

  const key = `user:${githubId}`;
  const existing = await env.SUBMISSIONS_KV.get(key);
  if (!existing) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const data = JSON.parse(existing);
  data.image_approved = approved;
  await env.SUBMISSIONS_KV.put(key, JSON.stringify(data));

  return Response.json({
    ok: true,
    username: data.username,
    imageApproved: approved,
  });
}

/**
 * POST /api/admin/config
 * Update system configuration.
 * Body: { key: "submissions_enabled", value: true }
 */
export async function handleAdminConfig(request, env) {
  const { user, response: authRes } = await requireAuth(request, env);
  if (authRes) return authRes;

  const { isMod, response: modRes } = await requireMod(user, env, getInstallationToken);
  if (modRes) return modRes;

  let requestBody;
  try {
    requestBody = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON in request body' }, { status: 400 });
  }
  const { key, value } = requestBody;

  // Whitelist of allowed config keys with type and range validation
  const configSchema = {
    submissions_enabled: { type: 'boolean' },
    draft_save_interval: { type: 'number', min: 10, max: 600 },
    max_pending_new: { type: 'number', min: 1, max: 10 },
    max_pending_trusted: { type: 'number', min: 1, max: 50 },
    max_image_size_kb: { type: 'number', min: 100, max: 10240 },
    max_images_per_submission: { type: 'number', min: 0, max: 20 },
  };

  const schema = configSchema[key];
  if (!schema) {
    return Response.json(
      { error: `Unknown config key: ${key}. Allowed: ${Object.keys(configSchema).join(', ')}` },
      { status: 400 }
    );
  }

  // Validate value type and range
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return Response.json(
      { error: `${key} must be a boolean (true/false)` },
      { status: 400 }
    );
  }
  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return Response.json(
        { error: `${key} must be an integer` },
        { status: 400 }
      );
    }
    if (value < schema.min || value > schema.max) {
      return Response.json(
        { error: `${key} must be between ${schema.min} and ${schema.max}` },
        { status: 400 }
      );
    }
  }

  await env.SUBMISSIONS_KV.put(`config:${key}`, String(value));

  return Response.json({ ok: true, key, value });
}

/**
 * DELETE /api/admin/branch?branch=users/badactor/spam-content
 * Force-delete a user's branch and close any associated PR.
 * Uses query parameter (not body) for DELETE compatibility.
 */
export async function handleAdminDeleteBranch(request, env) {
  const { user, response: authRes } = await requireAuth(request, env);
  if (authRes) return authRes;

  const { isMod, response: modRes } = await requireMod(user, env, getInstallationToken);
  if (modRes) return modRes;

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');
  if (!branch || !branch.startsWith('users/')) {
    return Response.json(
      { error: 'Invalid branch — must start with users/' },
      { status: 400 }
    );
  }

  const token = await getInstallationToken(env);

  // Close any open PR
  const pr = await getPRForBranch(env, token, branch);
  if (pr) {
    await closePR(env, token, pr.number);
  }

  // Delete the branch
  await deleteBranch(env, token, branch);

  return Response.json({ ok: true, deleted: branch, prClosed: pr?.number || null });
}
