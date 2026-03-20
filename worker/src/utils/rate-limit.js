/**
 * Rate limiting utilities.
 *
 * Trust tiers:
 *   New (0 merged PRs)     → 1 pending edit, throttled saves
 *   Trusted (1+ merged)    → 5 pending edits, throttled saves
 *   Mod (repo collaborator) → unlimited, no throttle
 *
 * Key insight: pending_count is derived from GitHub API (zero KV cost),
 * and last_draft_save lives in the JWT (zero KV cost).
 */

/**
 * Get the user's trust tier and limits.
 *
 * @param {Object} userRecord - The user's KV record
 * @param {boolean} isMod - Whether the user is a repo collaborator
 * @param {Object} config - Loaded config from KV (via loadConfig)
 * @returns {Object} Tier info with limits
 */
export function getUserTier(userRecord, isMod, config) {
  if (isMod) {
    return {
      tier: 'mod',
      maxPending: Infinity,
      saveThrottleSeconds: 0,
      canUploadImages: true,
    };
  }

  const mergedCount = userRecord?.merged_count || 0;
  const imageApproved = userRecord?.image_approved || false;

  if (mergedCount >= 1) {
    return {
      tier: 'trusted',
      maxPending: config.max_pending_trusted || 5,
      saveThrottleSeconds: config.draft_save_interval || 15,
      canUploadImages: imageApproved,
    };
  }

  return {
    tier: 'new',
    maxPending: config.max_pending_new || 1,
    saveThrottleSeconds: config.draft_save_interval || 15,
    canUploadImages: false,
  };
}

/**
 * Load rate limit config from KV (with defaults).
 *
 * @param {Object} kv - KV namespace binding
 * @returns {Promise<Object>} Config values
 */
// In-memory config cache — persists for the life of the Worker isolate.
// Cloudflare Workers recycle isolates periodically, so this acts as a
// short-lived cache (typically seconds to minutes). Reduces KV reads from
// 6 per request to 6 per isolate lifecycle.
let _configCache = null;
let _configCachedAt = 0;
const CONFIG_CACHE_TTL_MS = 60_000; // 1 minute

export function invalidateConfigCache() {
  _configCache = null;
  _configCachedAt = 0;
}

export async function loadConfig(kv) {
  // Return cached config if still fresh
  const now = Date.now();
  if (_configCache && (now - _configCachedAt) < CONFIG_CACHE_TTL_MS) {
    return _configCache;
  }

  const defaults = {
    submissions_enabled: true,
    draft_save_interval: 15,
    max_pending_new: 1,
    max_pending_trusted: 5,
    max_image_size_kb: 2048,
    max_images_per_submission: 3,
  };

  const config = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const stored = await kv.get(`config:${key}`);
    if (stored !== null) {
      // Parse booleans and numbers
      if (stored === 'true') config[key] = true;
      else if (stored === 'false') config[key] = false;
      else if (stored !== '' && !isNaN(stored)) config[key] = Number(stored);
      else config[key] = stored;
    } else {
      config[key] = defaultValue;
    }
  }

  // Cache the result
  _configCache = config;
  _configCachedAt = now;

  return config;
}

/**
 * Check if the draft save throttle allows a save.
 * The last_draft_save timestamp lives in the JWT, not KV.
 *
 * @param {string|null} lastDraftSave - ISO timestamp from JWT
 * @param {number} throttleSeconds - Minimum seconds between saves
 * @returns {{ allowed: boolean, waitSeconds: number }}
 */
export function checkSaveThrottle(lastDraftSave, throttleSeconds) {
  if (!lastDraftSave || throttleSeconds <= 0) {
    return { allowed: true, waitSeconds: 0 };
  }

  const lastSave = new Date(lastDraftSave).getTime();
  if (isNaN(lastSave)) {
    return { allowed: true, waitSeconds: 0 }; // Invalid date — allow save
  }
  const now = Date.now();
  const elapsed = (now - lastSave) / 1000;

  if (elapsed >= throttleSeconds) {
    return { allowed: true, waitSeconds: 0 };
  }

  return {
    allowed: false,
    waitSeconds: Math.ceil(throttleSeconds - elapsed),
  };
}

/**
 * Get or create a user record in KV.
 * Only writes to KV on first visit (1 write per new user, ever).
 *
 * @param {Object} kv - KV namespace binding
 * @param {string} githubId - GitHub user ID
 * @param {string} username - GitHub username
 * @returns {Promise<Object>} User record
 */
export async function getOrCreateUser(kv, githubId, username) {
  const key = `user:${githubId}`;
  const existing = await kv.get(key);

  if (existing) {
    let record;
    try {
      record = JSON.parse(existing);
    } catch {
      // Corrupted record — recreate it
      record = { username, merged_count: 0, image_approved: false, created_at: new Date().toISOString() };
      await kv.put(key, JSON.stringify(record));
      return record;
    }
    // Update username if the user renamed their GitHub account
    if (record.username !== username) {
      record.username = username;
      await kv.put(key, JSON.stringify(record));
    }
    return record;
  }

  // First visit — create the record (1 KV write)
  const record = {
    username,
    merged_count: 0,
    image_approved: false,
    created_at: new Date().toISOString(),
  };

  await kv.put(key, JSON.stringify(record));
  return record;
}
