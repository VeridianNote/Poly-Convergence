/**
 * Content validation utilities.
 *
 * Validates draft content before any branch/commit is created.
 * This prevents junk branches from empty or garbage submissions.
 */

const MIN_TITLE_LENGTH = 5;
const MIN_BODY_LENGTH = 50;

/**
 * Validate content before saving/submitting.
 *
 * @param {string} title - The content title
 * @param {string} body - The markdown body
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateContent(title, body) {
  const errors = [];

  // Title checks
  if (!title || typeof title !== 'string') {
    errors.push('Title is required.');
  } else {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < MIN_TITLE_LENGTH) {
      errors.push(`Title must be at least ${MIN_TITLE_LENGTH} characters.`);
    }
    if (trimmedTitle.length > 200) {
      errors.push('Title must be 200 characters or fewer.');
    }
  }

  // Body checks
  if (!body || typeof body !== 'string') {
    errors.push('Content body is required.');
  } else {
    // Strip frontmatter, HTML comments, and excessive whitespace for length check
    const strippedBody = body
      .replace(/^---[\s\S]*?---\n?/, '')         // Remove frontmatter
      .replace(/<!--[\s\S]*?-->/g, '')            // Remove HTML comments
      .replace(/\s+/g, ' ')                       // Collapse whitespace
      .trim();

    if (strippedBody.length < MIN_BODY_LENGTH) {
      errors.push(`Content must be at least ${MIN_BODY_LENGTH} characters of actual text.`);
    }

    // Must contain at least one sentence with punctuation
    // This catches keyboard mash and random character submissions
    if (!/[.?!]/.test(strippedBody)) {
      errors.push('Content must contain at least one complete sentence (ending with a period, question mark, or exclamation mark).');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Sanitize a title into a URL-safe slug.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')     // Remove non-word chars (except spaces and hyphens)
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Collapse multiple hyphens
    .replace(/^-|-$/g, '')        // Trim leading/trailing hyphens
    .substring(0, 60);            // Limit length
}

/**
 * Validate a wiki category path.
 * Must be a valid directory name within docs/.
 *
 * @param {string} category
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCategory(category) {
  if (!category || typeof category !== 'string') {
    return { valid: false, error: 'Category is required for wiki pages.' };
  }

  const trimmed = category.trim();

  if (trimmed.length < 2) {
    return { valid: false, error: 'Category must be at least 2 characters.' };
  }

  if (trimmed.length > 50) {
    return { valid: false, error: 'Category must be 50 characters or fewer.' };
  }

  // Must only contain lowercase letters, numbers, and hyphens.
  // Must start and end with a letter or number (not a hyphen).
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(trimmed)) {
    return { valid: false, error: 'Category must contain only lowercase letters, numbers, and hyphens, and must start/end with a letter or number.' };
  }

  // No path traversal (defense in depth — regex above already prevents this)
  if (trimmed.includes('..') || trimmed.includes('/')) {
    return { valid: false, error: 'Invalid category path.' };
  }

  return { valid: true };
}

/**
 * Validate a branch name parameter.
 * Must match users/<username>/<slug> format — no path traversal.
 *
 * @param {string} branch
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateBranch(branch) {
  if (!branch || typeof branch !== 'string') {
    return { valid: false, error: 'Missing branch parameter' };
  }
  // Must be exactly: users/<alphanumeric-hyphen-underscore>/<alphanumeric-hyphen-underscore>
  if (!/^users\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(branch)) {
    return { valid: false, error: 'Invalid branch name format' };
  }
  return { valid: true };
}

/**
 * Build the markdown file content with frontmatter.
 *
 * @param {Object} options
 * @param {'wiki'|'blog'} options.type
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} [options.category]
 * @param {string} [options.author]
 * @param {string[]} [options.tags]
 * @returns {string}
 */
export function buildMarkdownFile({ type, title, body, category, author, tags }) {
  const frontmatter = ['---'];
  const safeTitle = title.replace(/"/g, '\\"').replace(/\n/g, ' ');

  if (type === 'wiki') {
    frontmatter.push(`title: "${safeTitle}"`);
    frontmatter.push('sidebar_position: 99');
  } else if (type === 'blog') {
    frontmatter.push(`title: "${safeTitle}"`);
    // Sanitize author — only allow alphanumeric, hyphens, underscores (GitHub username format)
    if (author && /^[a-zA-Z0-9_-]+$/.test(author)) {
      frontmatter.push(`authors: [${author}]`);
    }
    // Sanitize tags — only allow alphanumeric + hyphens per tag
    if (tags && tags.length > 0) {
      const safeTags = tags.filter(t => /^[a-zA-Z0-9-]+$/.test(t));
      if (safeTags.length > 0) {
        frontmatter.push(`tags: [${safeTags.join(', ')}]`);
      }
    }
  }

  frontmatter.push('---');
  frontmatter.push('');

  return frontmatter.join('\n') + body;
}

/**
 * Compute the file path for a piece of content.
 *
 * @param {'wiki'|'blog'} type
 * @param {string} slug
 * @param {string} [category] - Wiki category (e.g., "foundational-concepts")
 * @param {string} [subcategory] - Optional new subcategory
 * @returns {string}
 */
export function computeFilePath(type, slug, category, subcategory) {
  if (type === 'blog') {
    const date = new Date().toISOString().split('T')[0];
    return `blog/${date}-${slug}.md`;
  }

  // Wiki page
  if (subcategory) {
    return `docs/${category}/${subcategory}/${slug}.md`;
  }
  return `docs/${category}/${slug}.md`;
}
