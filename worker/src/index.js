/**
 * Poly Convergence API Worker
 *
 * Main entry point — routes requests to handlers and manages cron triggers.
 *
 * Routes:
 *   /auth/login        → GitHub OAuth initiation
 *   /auth/callback     → OAuth code exchange, JWT session creation
 *   /auth/logout       → Clear session cookie
 *   /api/user          → Current user info + trust tier
 *   /api/config        → Public config (submissions enabled?)
 *   /api/categories    → List wiki categories
 *   /api/content       → Load published content from main (for editing)
 *   /api/drafts        → List user's drafts
 *   /api/draft         → Save/load/delete a draft
 *   /api/submit        → Submit draft for review (create PR)
 *   /api/status        → Check PR status for a draft
 *   /api/admin/*       → Admin endpoints (mod-only)
 *
 * Cron triggers:
 *   04:00 UTC daily    → Branch cleanup (stale branches/PRs)
 *   05:00 UTC daily    → Merge count sync (trust tiers)
 */

import { handlePreflight, withCors } from './middleware/cors.js';
import { handleLogin, handleCallback, handleLogout } from './routes/auth.js';
import { handleListDrafts, handleLoadDraft, handleSaveDraft, handleAbandonDraft, handleLoadContent, handleMergeBranch } from './routes/drafts.js';
import { handleSubmit, handleStatus } from './routes/submit.js';
import { handleGetUser, handleGetConfig, handleGetCategories } from './routes/user.js';
import { handleUploadImage } from './routes/upload.js';
import {
  handleAdminListUsers,
  handleAdminApproveImages,
  handleAdminConfig,
  handleAdminDeleteBranch,
} from './routes/admin.js';
import { runCleanup } from './cron/cleanup.js';
import { runMergeSync } from './cron/sync.js';

export default {
  /**
   * Handle HTTP requests.
   */
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handlePreflight(request, env);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      let response;

      // Auth routes (no CORS needed — these are redirects, not XHR)
      if (path === '/auth/login' && method === 'GET') {
        return handleLogin(request, env);
      }
      if (path === '/auth/callback' && method === 'GET') {
        return handleCallback(request, env);
      }

      // API routes (need CORS)
      if (path === '/auth/logout' && method === 'POST') {
        response = await handleLogout(request, env);
      }

      // User & config
      else if (path === '/api/user' && method === 'GET') {
        response = await handleGetUser(request, env);
      }
      else if (path === '/api/config' && method === 'GET') {
        response = await handleGetConfig(request, env);
      }
      else if (path === '/api/categories' && method === 'GET') {
        response = await handleGetCategories(request, env);
      }

      // Content (load from main for editing)
      else if (path === '/api/content' && method === 'GET') {
        response = await handleLoadContent(request, env);
      }

      // Drafts
      else if (path === '/api/drafts' && method === 'GET') {
        response = await handleListDrafts(request, env);
      }
      else if (path === '/api/draft' && method === 'GET') {
        response = await handleLoadDraft(request, env);
      }
      else if (path === '/api/draft' && method === 'POST') {
        response = await handleSaveDraft(request, env);
      }
      else if (path === '/api/draft' && method === 'DELETE') {
        response = await handleAbandonDraft(request, env);
      }

      // Branch merge (update from main)
      else if (path === '/api/merge' && method === 'POST') {
        response = await handleMergeBranch(request, env);
      }

      // Image upload
      else if (path === '/api/upload' && method === 'POST') {
        response = await handleUploadImage(request, env);
      }

      // Submissions
      else if (path === '/api/submit' && method === 'POST') {
        response = await handleSubmit(request, env);
      }
      else if (path === '/api/status' && method === 'GET') {
        response = await handleStatus(request, env);
      }

      // Admin routes
      else if (path === '/api/admin/users' && method === 'GET') {
        response = await handleAdminListUsers(request, env);
      }
      else if (path === '/api/admin/approve-images' && method === 'POST') {
        response = await handleAdminApproveImages(request, env);
      }
      else if (path === '/api/admin/config' && method === 'POST') {
        response = await handleAdminConfig(request, env);
      }
      else if (path === '/api/admin/branch' && method === 'DELETE') {
        response = await handleAdminDeleteBranch(request, env);
      }

      // Health check
      else if (path === '/' || path === '/health') {
        response = Response.json({
          status: 'ok',
          service: 'poly-convergence-api',
          timestamp: new Date().toISOString(),
        });
      }

      // 404
      else {
        response = Response.json(
          { error: 'Not found', path },
          { status: 404 }
        );
      }

      // Wrap all API responses with CORS headers
      return withCors(response, request, env);

    } catch (error) {
      console.error('Unhandled error:', error.message, error.stack);
      const errorResponse = Response.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
      return withCors(errorResponse, request, env);
    }
  },

  /**
   * Handle scheduled cron triggers.
   */
  async scheduled(event, env, ctx) {
    const hour = new Date(event.scheduledTime).getUTCHours();

    if (hour === 4) {
      // 04:00 UTC — Branch cleanup
      ctx.waitUntil(runCleanup(env));
    } else if (hour === 5) {
      // 05:00 UTC — Merge count sync
      ctx.waitUntil(runMergeSync(env));
    }
  },
};
