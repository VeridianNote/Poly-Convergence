/**
 * Image upload route handler.
 *
 * POST /api/upload   → Upload an image to the user's draft branch.
 * GET  /api/upload   → List uploaded images on a branch.
 * DELETE /api/upload → Delete an image from a branch.
 *
 * Trust-gated: requires either per-user image approval (KV) or
 * per-PR approval (images-approved label). Mods can always upload.
 */

import { requireAuth } from '../middleware/auth.js';
import { getInstallationToken } from '../github/app-token.js';
import {
  commitFileBase64,
  getPRForBranch,
  getCollaboratorPermission,
  deleteFile,
} from '../github/api.js';
import { validateBranch } from '../utils/validation.js';
import {
  getOrCreateUser,
  getUserTier,
  loadConfig,
} from '../utils/rate-limit.js';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * POST /api/upload
 * Upload an image to the user's draft branch.
 * Body: multipart/form-data with `image` (file) and `branch` (string).
 */
export async function handleUploadImage(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  // Parse multipart form data
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('image');
  const branch = formData.get('branch');

  if (!file || !(file instanceof File)) {
    return Response.json({ error: 'Missing image file' }, { status: 400 });
  }

  // Validate branch
  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);
  const config = await loadConfig(env.SUBMISSIONS_KV);

  // Check if user is a mod (single call, reused for kill switch + permissions)
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  // Check kill switch — only mods can upload when submissions are paused
  if (!config.submissions_enabled && !isMod) {
    return Response.json({ error: 'Submissions are currently paused.' }, { status: 403 });
  }

  // Security: users can only upload to their own branches
  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Check image upload permission
  const userRecord = await getOrCreateUser(env.SUBMISSIONS_KV, user.sub, user.username);
  const tier = getUserTier(userRecord, isMod, config);

  if (!tier.canUploadImages) {
    // Check per-PR label as fallback
    const pr = await getPRForBranch(env, token, branch);
    const hasLabel = pr?.labels?.some(l => l.name === 'images-approved');
    if (!hasLabel) {
      return Response.json(
        { error: 'Image uploads are not enabled for your account. Use <!-- image: description --> placeholders instead.' },
        { status: 403 }
      );
    }
  }

  // Validate file type
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json(
      { error: `File type not allowed. Accepted: JPG, PNG, WebP, GIF.` },
      { status: 400 }
    );
  }

  // Validate file size
  const maxSizeBytes = (config.max_image_size_kb || 2048) * 1024;
  if (file.size > maxSizeBytes) {
    const maxMB = ((config.max_image_size_kb || 2048) / 1024).toFixed(0);
    return Response.json(
      { error: `Image too large. Maximum size: ${maxMB} MB.` },
      { status: 400 }
    );
  }

  // Count existing images on the branch
  const maxImages = config.max_images_per_submission || 3;
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
    // Fail safe — deny upload if we can't verify image count
    return Response.json(
      { error: 'Unable to verify image count. Please try again.' },
      { status: 500 }
    );
  }

  const compareData = await compareRes.json();
  const imageFiles = (compareData.files || []).filter(
    f => f.filename.startsWith('static/img/user-uploads/')
  );
  if (imageFiles.length >= maxImages) {
    return Response.json(
      { error: `Maximum ${maxImages} images per submission.` },
      { status: 400 }
    );
  }

  // Sanitize filename and generate unique path
  const ext = EXTENSION_MAP[file.type];
  const baseName = sanitizeFilename(file.name);
  const uniqueSuffix = Date.now().toString(36);
  const filename = `${baseName}-${uniqueSuffix}.${ext}`;
  const filePath = `static/img/user-uploads/${user.username}/${filename}`;

  // Convert to base64 (chunked to avoid O(n^2) string concatenation)
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK_SIZE = 8192;
  const chunks = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  const base64Content = btoa(chunks.join(''));

  // Commit to the branch
  await commitFileBase64(
    env, token, branch, filePath, base64Content,
    `Add image: ${filename}`
  );

  return Response.json({
    ok: true,
    path: `/img/user-uploads/${user.username}/${filename}`,
    previewUrl: `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${branch}/${filePath}`,
    filename,
    imageNumber: imageFiles.length + 1,
  });
}

/**
 * GET /api/upload?branch=...
 * List images uploaded to a branch.
 */
export async function handleListImages(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  const url = new URL(request.url);
  const branch = url.searchParams.get('branch');

  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Security: non-mods can only list their own branches
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Use compare API to find image files on the branch
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
    return Response.json({ ok: true, images: [] });
  }

  const compareData = await compareRes.json();
  const imageFiles = (compareData.files || []).filter(
    f => f.filename.startsWith('static/img/user-uploads/') && f.status !== 'removed'
  );

  const images = imageFiles.map(f => {
    const sitePath = '/' + f.filename.replace(/^static\//, '');
    const filename = f.filename.split('/').pop();
    return {
      path: sitePath,
      previewUrl: `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${branch}/${f.filename}`,
      filename,
    };
  });

  return Response.json({ ok: true, images });
}

/**
 * DELETE /api/upload
 * Delete an image from a branch.
 * Body: { branch, path } where path is site-relative (e.g. /img/user-uploads/user/file.png).
 */
export async function handleDeleteImage(request, env) {
  const { user, response } = await requireAuth(request, env);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { branch, path: sitePath } = body;

  const branchCheck = validateBranch(branch);
  if (!branchCheck.valid) {
    return Response.json({ error: branchCheck.error }, { status: 400 });
  }

  // Validate path is within user-uploads (prevent deleting arbitrary files)
  if (!sitePath || !sitePath.startsWith('/img/user-uploads/')) {
    return Response.json({ error: 'Invalid image path' }, { status: 400 });
  }

  const token = await getInstallationToken(env);

  // Security: non-mods can only delete from their own branches
  const permission = await getCollaboratorPermission(env, token, user.username);
  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod && !branch.startsWith(`users/${user.username}/`)) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }

  // Convert site path to repo path
  const repoPath = `static${sitePath}`;

  await deleteFile(env, token, branch, repoPath, `Delete image: ${repoPath.split('/').pop()}`);

  return Response.json({ ok: true });
}

/**
 * Sanitize a filename — keep only alphanumeric, hyphens, underscores.
 * Strips the extension (caller provides it from MIME type).
 */
function sanitizeFilename(name) {
  return name
    .replace(/\.[^.]+$/, '')           // Remove extension
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')     // Replace non-safe chars
    .replace(/-+/g, '-')              // Collapse hyphens
    .replace(/^-|-$/g, '')            // Trim hyphens
    .substring(0, 40)                 // Limit length
    || 'image';                       // Fallback
}
