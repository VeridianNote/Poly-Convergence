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
import { invalidateConfigCache } from '../utils/rate-limit.js';
import { validateBranch } from '../utils/validation.js';
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

  // Get KV records for each user (paginate — KV.list returns max 1000 keys)
  const users = [];
  let cursor = undefined;
  const allKeys = [];
  do {
    const kvList = await env.SUBMISSIONS_KV.list({ prefix: 'user:', cursor });
    allKeys.push(...kvList.keys);
    cursor = kvList.list_complete ? undefined : kvList.cursor;
  } while (cursor);

  for (const key of allKeys) {
    const record = await env.SUBMISSIONS_KV.get(key.name);
    if (!record) continue;

    let data;
    try {
      data = JSON.parse(record);
    } catch {
      continue; // Skip corrupted KV entries
    }
    const userBranches = userMap[data.username] || [];

    // Get last activity for each branch.
    // Per-branch try/catch so one GitHub error doesn't crash the list.
    const branchDetails = await Promise.all(
      userBranches.map(async (branchName) => {
        let lastCommit = null;
        let pr = null;
        try {
          lastCommit = await getLastCommitDate(env, token, branchName);
          pr = await getPRForBranch(env, token, branchName);
        } catch {
          // Transient GitHub error — show branch with partial info
        }
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
  // githubId must be a numeric string (GitHub user IDs are integers)
  if (typeof githubId !== 'string' || !/^\d+$/.test(githubId)) {
    return Response.json(
      { error: 'githubId must be a numeric string' },
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

  // Invalidate in-memory cache so this isolate sees the new value immediately
  invalidateConfigCache();

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
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Close any open PR (best-effort — don't block branch deletion)
  let prNumber = null;
  try {
    const pr = await getPRForBranch(env, token, branch);
    if (pr) {
      prNumber = pr.number;
      await closePR(env, token, pr.number);
    }
  } catch {
    // Transient GitHub error — proceed with branch deletion
  }

  // Delete the branch
  await deleteBranch(env, token, branch);

  return Response.json({ ok: true, deleted: branch, prClosed: prNumber });
}
