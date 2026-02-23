/**
 * Branch cleanup cron job.
 *
 * Runs daily at 04:00 UTC.
 * - Lists all user branches (users/username/slug pattern)
 * - Deletes branches with no activity for 90 days (and no open PR)
 * - Auto-closes stale PRs with a comment, then deletes the branch
 */

import { getInstallationToken } from '../github/app-token.js';
import {
  listBranches,
  deleteBranch,
  getPRForBranch,
  closePR,
  addComment,
  getLastCommitDate,
} from '../github/api.js';

const STALE_DAYS = 90;

const STALE_PR_COMMENT =
  'This submission has been automatically closed due to 90 days of inactivity. ' +
  'If you\'d like to continue working on this, please start a new draft at ' +
  '[polyconvergence.com/contribute](https://polyconvergence.com/contribute).';

/**
 * Run the branch cleanup cron job.
 */
export async function runCleanup(env) {
  const token = await getInstallationToken(env);
  const branches = await listBranches(env, token, 'users/');

  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_DAYS * 24 * 60 * 60 * 1000);

  let cleaned = 0;
  let errors = 0;

  for (const branch of branches) {
    try {
      const lastCommit = await getLastCommitDate(env, token, branch.name);
      if (!lastCommit || lastCommit > cutoff) continue;

      // Branch is stale — check for open PR
      const pr = await getPRForBranch(env, token, branch.name);

      if (pr) {
        // Close PR with a comment explaining the auto-closure
        await addComment(env, token, pr.number, STALE_PR_COMMENT);
        await closePR(env, token, pr.number);
      }

      // Delete the stale branch
      await deleteBranch(env, token, branch.name);
      cleaned++;
    } catch (err) {
      console.error(`Error cleaning up branch ${branch.name}:`, err.message);
      errors++;
    }
  }

  console.log(`Branch cleanup complete: ${cleaned} cleaned, ${errors} errors`);
  return { cleaned, errors };
}
