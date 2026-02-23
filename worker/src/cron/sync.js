/**
 * Merge count sync cron job.
 *
 * Runs daily at 05:00 UTC.
 * Queries merged PRs from user branches and updates merged_count in KV.
 * This powers the trust tier system (0 merged = new, 1+ = trusted).
 *
 * KV writes: ~1-5 per day (only for users whose count actually changed).
 */

import { getInstallationToken } from '../github/app-token.js';

/**
 * Run the merge count sync cron job.
 */
export async function runMergeSync(env) {
  const token = await getInstallationToken(env);

  // Get all closed+merged PRs from user branches
  // Paginate through all closed PRs
  const mergedByUser = {};
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls?state=closed&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'poly-convergence-bot',
        },
      }
    );

    if (!res.ok) {
      console.error(`Failed to fetch closed PRs page ${page}: ${res.status}`);
      break;
    }

    const prs = await res.json();
    if (prs.length === 0) break;

    for (const pr of prs) {
      // Only count merged PRs from user branches
      if (!pr.merged_at) continue;
      if (!pr.head.ref.startsWith('users/')) continue;

      const username = pr.head.ref.split('/')[1];
      mergedByUser[username] = (mergedByUser[username] || 0) + 1;
    }

    if (prs.length < 100) break;
    page++;
  }

  // Update KV records where the count has changed
  let updated = 0;

  // Load all user records once (hoisted outside the loop to avoid N redundant list calls)
  // KV list returns max 1000 keys per call — paginate if needed
  const allUserRecords = [];
  let cursor = undefined;
  do {
    const kvList = await env.SUBMISSIONS_KV.list({ prefix: 'user:', cursor });
    for (const key of kvList.keys) {
      const record = await env.SUBMISSIONS_KV.get(key.name);
      if (record) {
        allUserRecords.push({ key: key.name, data: JSON.parse(record) });
      }
    }
    cursor = kvList.list_complete ? undefined : kvList.cursor;
  } while (cursor);

  for (const [username, newCount] of Object.entries(mergedByUser)) {
    const userEntry = allUserRecords.find(r => r.data.username === username);
    if (userEntry && userEntry.data.merged_count !== newCount) {
      userEntry.data.merged_count = newCount;
      await env.SUBMISSIONS_KV.put(userEntry.key, JSON.stringify(userEntry.data));
      updated++;
    }
  }

  console.log(`Merge count sync complete: ${Object.keys(mergedByUser).length} users with merges, ${updated} KV records updated`);
  return { usersWithMerges: Object.keys(mergedByUser).length, updated };
}
