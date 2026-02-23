/**
 * GitHub API wrapper for repo operations.
 *
 * All operations use the GitHub App installation token.
 * The Worker NEVER pushes to main — only creates user branches and PRs.
 */

const GITHUB_API = 'https://api.github.com';

/**
 * Encode a UTF-8 string to base64 (replaces deprecated unescape/encodeURIComponent pattern).
 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Make an authenticated GitHub API request.
 */
async function githubFetch(path, token, options = {}) {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'poly-convergence-bot',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  return res;
}

/**
 * Get the SHA of the latest commit on a branch.
 */
export async function getBranchSHA(env, token, branch) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/ref/heads/${branch}`,
    token
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.object.sha;
}

/**
 * Create a new branch from main.
 */
export async function createBranch(env, token, branchName) {
  const mainSHA = await getBranchSHA(env, token, 'main');
  if (!mainSHA) {
    throw new Error('Could not get main branch SHA');
  }

  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: mainSHA,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    // 422 = branch already exists
    if (res.status === 422) {
      return { exists: true };
    }
    throw new Error(`Failed to create branch: ${res.status} ${text}`);
  }

  return { exists: false, sha: mainSHA };
}

/**
 * Create or update a file on a branch.
 */
export async function commitFile(env, token, branch, path, content, message) {
  // Check if file already exists (to get its SHA for updates)
  const existingRes = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
    token
  );

  const body = {
    message,
    content: utf8ToBase64(content),
    branch,
  };

  if (existingRes.ok) {
    const existing = await existingRes.json();
    body.sha = existing.sha;
  }

  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to commit file: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get file content from a branch.
 */
export async function getFileContent(env, token, branch, path) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
    token
  );

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to get file: ${res.status}`);
  }

  const data = await res.json();
  // GitHub returns base64-encoded content
  // Decode base64 to UTF-8 (replaces deprecated escape/decodeURIComponent pattern)
  const binaryStr = atob(data.content.replace(/\n/g, ''));
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const decoded = new TextDecoder().decode(bytes);
  return { content: decoded, sha: data.sha };
}

/**
 * List all branches matching a prefix (e.g., "users/octocat/").
 */
export async function listBranches(env, token, prefix) {
  const branches = [];
  let page = 1;

  while (true) {
    const res = await githubFetch(
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/branches?per_page=100&page=${page}`,
      token
    );

    if (!res.ok) {
      throw new Error(`Failed to list branches: ${res.status}`);
    }

    const data = await res.json();
    for (const branch of data) {
      if (branch.name.startsWith(prefix)) {
        branches.push(branch);
      }
    }

    if (data.length < 100) break;
    page++;
  }

  return branches;
}

/**
 * Delete a branch.
 */
export async function deleteBranch(env, token, branchName) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/git/refs/heads/${branchName}`,
    token,
    { method: 'DELETE' }
  );

  // 204 = success, 422 = already deleted
  return res.ok || res.status === 422;
}

/**
 * Create a pull request.
 */
export async function createPullRequest(env, token, { title, body, head, base = 'main', labels = [] }) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ title, body, head, base }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create PR: ${res.status} ${text}`);
  }

  const pr = await res.json();

  // Apply labels if any
  if (labels.length > 0) {
    await addLabels(env, token, pr.number, labels);
  }

  return pr;
}

/**
 * List open PRs for a specific head branch prefix (e.g., "users/octocat").
 */
export async function listOpenPRs(env, token, headPrefix) {
  const prs = [];
  let page = 1;

  while (true) {
    const res = await githubFetch(
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls?state=open&per_page=100&page=${page}`,
      token
    );

    if (!res.ok) {
      throw new Error(`Failed to list PRs: ${res.status}`);
    }

    const data = await res.json();
    for (const pr of data) {
      if (pr.head.ref.startsWith(headPrefix)) {
        prs.push(pr);
      }
    }

    if (data.length < 100) break;
    page++;
  }

  return prs;
}

/**
 * Get a single PR by branch name.
 */
export async function getPRForBranch(env, token, branchName) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls?state=open&head=${env.GITHUB_OWNER}:${branchName}&per_page=1`,
    token
  );

  if (!res.ok) {
    throw new Error(`Failed to check PR for branch ${branchName}: ${res.status}`);
  }
  const data = await res.json();
  return data.length > 0 ? data[0] : null;
}

/**
 * Close a PR.
 */
export async function closePR(env, token, prNumber) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/pulls/${prNumber}`,
    token,
    {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' }),
    }
  );
  return res.ok;
}

/**
 * Add labels to an issue/PR.
 */
export async function addLabels(env, token, issueNumber, labels) {
  // Ensure labels exist first
  for (const label of labels) {
    await githubFetch(
      `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/labels`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({
          name: label,
          color: getDefaultLabelColor(label),
        }),
      }
    );
    // Ignore 422 (label already exists)
  }

  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/labels`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ labels }),
    }
  );
  return res.ok;
}

/**
 * Add a comment to a PR.
 */
export async function addComment(env, token, issueNumber, body) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/issues/${issueNumber}/comments`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    }
  );
  return res.ok;
}

/**
 * Get the last commit date for a branch.
 */
export async function getLastCommitDate(env, token, branchName) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/commits?sha=${branchName}&per_page=1`,
    token
  );

  if (!res.ok) return null;
  const data = await res.json();
  if (data.length === 0) return null;
  return new Date(data[0].commit.committer.date);
}

/**
 * List directory contents (for wiki categories).
 */
export async function listDirectoryContents(env, token, path, branch = 'main') {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${branch}`,
    token
  );

  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data;
}

/**
 * Check if the user is a repo collaborator and get their permission level.
 */
export async function getCollaboratorPermission(env, token, username) {
  const res = await githubFetch(
    `/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/collaborators/${username}/permission`,
    token
  );

  if (!res.ok) return null;
  const data = await res.json();
  return data.permission; // "admin", "write", "read", "none"
}

/**
 * Get default label colors.
 */
function getDefaultLabelColor(label) {
  const colors = {
    'community-submission': '0075ca',
    'wiki': '7057ff',
    'blog': 'e4e669',
    'new-contributor': 'fbca04',
    'images-approved': '0e8a16',
    'needs-images': 'd93f0b',
    'needs-revision': 'f9d0c4',
    'priority': 'b60205',
  };
  return colors[label] || 'ededed';
}
