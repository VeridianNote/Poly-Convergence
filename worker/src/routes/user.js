/**
 * User route handlers.
 *
 * GET /api/user       → Get current user info, trust tier, and limits
 * GET /api/config     → Get public config (submissions enabled, etc.)
 * GET /api/categories → List existing wiki categories
 */

import { getUser } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  getOrCreateUser,
  getUserTier,
  loadConfig,
} from '../utils/rate-limit.js';
import {
  getCollaboratorPermission,
  listOpenPRs,
  listBranches,
  listDirectoryContents,
} from '../github/api.js';

/**
 * GET /api/user
 * Returns the current user's identity, trust tier, and limits.
 * Returns null (not an error) if not authenticated.
 */
export async function handleGetUser(request, env) {
  const user = await getUser(request, env);

  if (!user) {
    return Response.json({ user: null });
  }

  const token = await getInstallationToken(env);

  // Get user record from KV
  const userRecord = await getOrCreateUser(
    env.SUBMISSIONS_KV,
    user.sub,
    user.username
  );

  // Check if user is a mod
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  // Load config for throttle info and tier limits
  const config = await loadConfig(env.SUBMISSIONS_KV);

  // Get trust tier
  const tier = getUserTier(userRecord, isMod, config);

  // Get pending count (from GitHub API, not KV)
  const userBranches = await listBranches(env, token, `users/${user.username}/`);
  const pendingCount = userBranches.length;

  return Response.json({
    user: {
      id: user.sub,
      username: user.username,
      avatar: user.avatar,
      isMod,
      tier: tier.tier,
      mergedCount: userRecord.merged_count,
      imageApproved: userRecord.image_approved,
      pendingCount,
      maxPending: tier.maxPending === Infinity ? null : tier.maxPending,
      saveThrottleSeconds: tier.saveThrottleSeconds,
      lastDraftSave: user.last_draft_save,
      canUploadImages: tier.canUploadImages,
    },
  });
}

/**
 * GET /api/config
 * Returns public configuration (doesn't require auth).
 */
export async function handleGetConfig(request, env) {
  const config = await loadConfig(env.SUBMISSIONS_KV);

  return Response.json({
    submissionsEnabled: config.submissions_enabled,
    draftSaveInterval: config.draft_save_interval,
    maxImageSizeKB: config.max_image_size_kb,
    maxImagesPerSubmission: config.max_images_per_submission,
  });
}

/**
 * GET /api/categories
 * List existing wiki categories (directories under docs/).
 */
export async function handleGetCategories(request, env) {
  const token = await getInstallationToken(env);

  const contents = await listDirectoryContents(env, token, 'docs');
  const categories = contents
    .filter(item => item.type === 'dir')
    .map(item => ({
      name: item.name,
      label: item.name
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
      path: item.path,
    }));

  return Response.json({ categories });
}
