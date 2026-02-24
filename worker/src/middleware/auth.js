/**
 * Authentication middleware.
 *
 * Extracts and verifies the JWT from the session cookie.
 * Attaches the decoded user payload to the request context.
 */

import { verifyJWT, getSessionToken } from '../utils/jwt.js';
import { getCollaboratorPermission } from '../github/api.js';

/**
 * Verify the JWT and return the user payload.
 * Returns null if no valid session exists (caller decides how to handle).
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<Object|null>} User payload or null
 */
export async function getUser(request, env) {
  const token = getSessionToken(request);
  if (!token) return null;

  return verifyJWT(token, env.JWT_SECRET);
}

/**
 * Require authentication. Returns a 401 JSON response if not authenticated.
 *
 * @param {Request} request
 * @param {Object} env
 * @returns {Promise<{user: Object, response?: Response}>}
 */
export async function requireAuth(request, env) {
  const user = await getUser(request, env);
  if (!user) {
    return {
      user: null,
      response: Response.json(
        { error: 'Not authenticated', code: 'UNAUTHORIZED' },
        { status: 401 }
      ),
    };
  }
  return { user, response: null };
}

/**
 * Require mod (collaborator) status. Returns 403 if not a mod.
 * Must be called after requireAuth.
 *
 * @param {Object} user - The decoded JWT user payload
 * @param {Object} env
 * @param {Function} getInstallationToken - Function to get GitHub App token
 * @returns {Promise<{isMod: boolean, response?: Response}>}
 */
export async function requireMod(user, env, getInstallationToken) {
  const token = await getInstallationToken(env);
  const permission = await getCollaboratorPermission(env, token, user.username);

  if (permission === null) {
    return {
      isMod: false,
      response: Response.json(
        { error: 'Failed to check permissions', code: 'PERMISSION_CHECK_FAILED' },
        { status: 500 }
      ),
    };
  }

  const isMod = permission === 'admin' || permission === 'write';

  if (!isMod) {
    return {
      isMod: false,
      response: Response.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 }
      ),
    };
  }

  return { isMod: true, response: null };
}
