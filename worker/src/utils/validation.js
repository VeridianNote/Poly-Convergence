/**
 * Content validation utilities.
 *
 * Validates draft content before any branch/commit is created.
 * This prevents junk branches from empty or garbage submissions.
 * Includes markdown sanitization to prevent XSS and HTML injection.
 */

const MIN_TITLE_LENGTH = 5;
const MIN_BODY_LENGTH = 50;
const MAX_BODY_LENGTH = 100_000; // ~100KB — generous for markdown, prevents abuse

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
  } else if (body.length > MAX_BODY_LENGTH) {
    errors.push(`Content must be ${MAX_BODY_LENGTH.toLocaleString()} characters or fewer.`);
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

    // Abuse detection heuristics
    const abuseCheck = detectAbuse(title, strippedBody);
    if (abuseCheck) {
      errors.push(abuseCheck);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Basic abuse detection heuristics.
 * Returns an error message if abuse is detected, or null if clean.
 */
function detectAbuse(title, body) {
  const combined = `${title} ${body}`.toLowerCase();

  // Excessive character repetition — "aaaaaa" or "!!!!!!" (5+ repeats)
  if (/(.)\1{9,}/.test(combined)) {
    return 'Content contains excessive character repetition.';
  }

  // Very low word diversity — many repeated words indicates copy-paste spam
  const words = combined.match(/\b[a-z]{3,}\b/g) || [];
  if (words.length >= 20) {
    const unique = new Set(words);
    const diversityRatio = unique.size / words.length;
    if (diversityRatio < 0.15) {
      return 'Content appears to contain repetitive or duplicated text.';
    }
  }

  // Excessive external links — more than 10 links in body suggests spam
  const linkCount = (body.match(/https?:\/\//g) || []).length;
  if (linkCount > 10) {
    return 'Content contains too many external links.';
  }

  return null;
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
  // Path traversal defense
  if (branch.includes('..')) {
    return { valid: false, error: 'Invalid branch name format' };
  }
  // Must be exactly: users/<username>/<slug>
  // Username allows dots (valid in GitHub usernames), slug does not.
  if (!/^users\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9_-]+$/.test(branch)) {
    return { valid: false, error: 'Invalid branch name format' };
  }
  return { valid: true };
}

/**
 * Validate a content file path (for editing existing pages).
 * Must be a wiki/ or stories/ path with no traversal.
 *
 * @param {string} path
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateContentPath(path) {
  if (!path || typeof path !== 'string') {
    return { valid: false, error: 'Path is required.' };
  }
  if (!/^(wiki|stories)\/[a-zA-Z0-9/_-]+\.mdx?$/.test(path)) {
    return { valid: false, error: 'Invalid path format.' };
  }
  if (path.includes('..')) {
    return { valid: false, error: 'Invalid path.' };
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
  // Escape backslashes first (before other escapes add more backslashes),
  // then double quotes, then collapse newlines. This prevents YAML injection
  // via backslash escape sequences in double-quoted YAML strings.
  const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

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
    return `stories/${date}-${slug}.md`;
  }

  // Wiki page
  if (subcategory) {
    return `wiki/${category}/${subcategory}/${slug}.md`;
  }
  return `wiki/${category}/${slug}.md`;
}

// ---------------------------------------------------------------------------
// Markdown sanitization — prevents XSS / HTML injection from untrusted users
// ---------------------------------------------------------------------------

/**
 * HTML tags that have no legitimate use in user-submitted articles.
 * These are stripped entirely (opening, closing, and self-closing forms).
 */
const DANGEROUS_TAGS = [
  'script', 'iframe', 'svg', 'style', 'meta', 'link',
  'object', 'embed', 'form', 'input', 'button', 'textarea',
  'select', 'base', 'applet', 'noscript', 'frame', 'frameset',
  'video', 'audio', 'source', 'picture', 'math',
].join('|');

const DANGEROUS_TAGS_RE = new RegExp(
  `<\\/?(?:${DANGEROUS_TAGS})\\b[^>]*>`, 'gi'
);

/** Protocols that are dangerous in href/src attributes. */
const DANGEROUS_PROTOCOL_RE = /^(javascript|data|vbscript|blob|filesystem):/i;

/**
 * Check if a URL uses a dangerous protocol, after normalizing it the way
 * browsers do: decode HTML entities, strip ASCII whitespace from the scheme
 * portion (browsers ignore tabs, newlines, CR in URL schemes), and trim.
 */
function hasDangerousProtocol(rawUrl) {
  const decoded = decodeHTMLEntities(rawUrl).trim();
  // Strip ASCII whitespace that browsers ignore in URL schemes (tab, LF, CR)
  const normalized = decoded.replace(/[\t\n\r]/g, '');
  return DANGEROUS_PROTOCOL_RE.test(normalized);
}

/**
 * Decode HTML entities commonly used in XSS bypass attempts.
 * Browsers decode entities in attribute values before resolving URLs,
 * so we must decode before testing against protocol/path checks.
 * The ;? makes semicolons optional (some browsers accept &#106avascript).
 */
function decodeHTMLEntities(str) {
  // Loop until output stabilizes — handles triple+ encoding like
  // &amp;amp;#106; → &amp;#106; → &#106; → j
  // Cap at 5 iterations to prevent infinite loops on adversarial input.
  let result = str;
  for (let i = 0; i < 5; i++) {
    const prev = result;
    // Decode &amp; FIRST so &amp;#106; → &#106; before numeric decode
    result = result.replace(/&amp;/gi, '&');
    // Decode numeric/hex entities (optional semicolons — browsers accept both)
    result = result
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&#(\d+);?/gi, (_, dec) => String.fromCharCode(parseInt(dec)));
    // Decode named entities
    result = result
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&tab;/gi, '\t')
      .replace(/&newline;/gi, '\n')
      .replace(/&nbsp;/gi, ' ');
    if (result === prev) break; // Stable — no more entities to decode
  }
  return result;
}

/**
 * Sanitize user-submitted markdown to prevent XSS and HTML injection.
 *
 * Mods bypass all sanitization. For untrusted users, this function:
 *  1. Preserves code blocks (fenced and inline) from false-positive stripping
 *  2. Resolves {{image:N}} placeholders to safe markdown image syntax
 *     (alt text sanitized to prevent markdown syntax breakout)
 *  3. Strips MDX constructs (import/export/expressions) — prevents JS execution
 *  4. Strips dangerous HTML tags iteratively (catches mutation XSS)
 *  5. Strips on* event handler attributes from all remaining HTML tags
 *  6. Strips style attributes (can contain url() for tracking)
 *  7. Strips dangerous resource-loading attrs (srcset, background, ping, etc.)
 *  8. Validates <img> src — only internal /img/ paths, entity-decoded
 *  9. Validates <a> href — strips dangerous protocols (handles unclosed tags)
 * 10. Validates markdown image URLs — entity-decoded, internal /img/ only
 * 11. Validates markdown link URLs — entity-decoded protocol checking
 * 12. Strips dangerous autolinks — entity-decoded protocol checking
 * 13. Strips dangerous reference-style link definitions — entity-decoded
 *
 * Entity decoding: All URL/protocol checks use hasDangerousProtocol() which
 * decodes entities (looping to handle triple+ encoding), strips ASCII
 * whitespace from protocol names (browsers ignore tabs/newlines in schemes),
 * and checks against DANGEROUS_PROTOCOL_RE.
 *
 * @param {string} body - The markdown body to sanitize
 * @param {Object} [options]
 * @param {boolean} [options.isMod=false] - If true, skip all sanitization
 * @param {Object<number, string>} [options.imageMap=null] - Map of image
 *   number → path for resolving {{image:N}} placeholders
 * @returns {string} Sanitized markdown body
 */
export function sanitizeMarkdown(body, { isMod = false, imageMap = null } = {}) {
  if (isMod) return body;

  let result = body;

  // Strip null bytes — prevents injection of our placeholder pattern
  result = result.replace(/\x00/g, '');

  // --- Preserve code blocks (must happen before any other processing) ------

  const preserved = [];

  // Fenced code blocks (``` or ~~~, with optional language identifier).
  // Closing fence must be at the start of a line with the same delimiter.
  // SECURITY: For backtick fences, the info string must NOT contain backticks
  // (CommonMark spec §4.5). Using [^`\n]* instead of .* prevents an attacker
  // from crafting a "code block" that the sanitizer preserves (skipping all
  // sanitization) but CommonMark rejects (rendering content as live HTML).
  // Tilde fences DO allow backticks in info strings per spec — no change needed.
  result = result.replace(/^(`{3,})[^`\n]*\n([\s\S]*?)^\1\s*$/gm, (match) => {
    preserved.push(match);
    return `\x00PRESERVED_${preserved.length - 1}\x00`;
  });
  result = result.replace(/^(~{3,}).*\n([\s\S]*?)^\1\s*$/gm, (match) => {
    preserved.push(match);
    return `\x00PRESERVED_${preserved.length - 1}\x00`;
  });

  // Inline code (single or multi-backtick delimited).
  result = result.replace(/(`+)([\s\S]*?)\1/g, (match) => {
    preserved.push(match);
    return `\x00PRESERVED_${preserved.length - 1}\x00`;
  });

  // --- Resolve {{image:N}} placeholders ------------------------------------

  if (imageMap) {
    result = result.replace(
      /\{\{image:(\d+)(?:\s*\|\s*([^}]*))?\}\}/gi,
      (match, num, alt) => {
        const path = imageMap[parseInt(num)];
        if (!path) return match; // Leave unresolved — harmless literal text
        // Sanitize alt text — strip characters that could break out of
        // the ![alt](url) markdown syntax and inject arbitrary markdown.
        // []() are the breakout chars; {} could interfere with other placeholders.
        const safeAlt = (alt || '').trim()
          .replace(/[\[\]\(\)\{\}]/g, '')
          .substring(0, 200) || 'User image';
        return `![${safeAlt}](${path})`;
      }
    );
  }

  // --- Strip MDX constructs ------------------------------------------------
  // Docusaurus processes .md files as MDX by default. MDX allows:
  //   import Foo from './bar'     → imports JavaScript modules
  //   export const x = ...        → exports values/components
  //   {expression}                → evaluates JavaScript inline
  // All three are full XSS vectors. Strip import/export at start-of-line,
  // and escape { to \{ so MDX treats braces as literal text.

  // Strip import/export statements at start of line (outside code blocks,
  // which are already preserved as \x00PRESERVED_N\x00 tokens)
  result = result.replace(/^import\s+.+$/gm, '');
  result = result.replace(/^export\s+.+$/gm, '');

  // Escape { so MDX doesn't evaluate expressions. \{ renders as literal {.
  // Skip our preserved code block tokens (they don't contain real braces).
  // Also skip {{image:N}} placeholders — those were already resolved above.
  result = result.replace(/\{/g, '\\{');

  // --- Strip dangerous HTML tags -------------------------------------------
  // Run iteratively — stripping a tag nested inside another (e.g.,
  // <s<iframe>tyle>) can create a new dangerous tag from the leftovers.
  // Loop until no more matches are found (typically 1-2 passes).

  while (DANGEROUS_TAGS_RE.test(result)) {
    DANGEROUS_TAGS_RE.lastIndex = 0; // Reset stateful regex
    result = result.replace(DANGEROUS_TAGS_RE, '');
  }

  // --- Strip on* event handler attributes from all remaining tags ----------
  // Use [\s/]+ to also match solidus (`/`) between tag name and attributes.
  // HTML5 parsers treat `/` as whitespace in this context, so attackers can
  // use <img/onerror="alert(1)"> to bypass \s+ matching.

  result = result.replace(
    /<([a-zA-Z][a-zA-Z0-9]*)[\s/]+([^>]*?)\s*(\/?)\s*>/g,
    (match, tag, attrs, selfClose) => {
      // Only process tags that actually have attributes
      const cleaned = attrs
        .replace(/[\s/]*on\w+\s*=\s*"[^"]*"/gi, '')
        .replace(/[\s/]*on\w+\s*=\s*'[^']*'/gi, '')
        .replace(/[\s/]*on\w+\s*=\s*[^\s>"']+/gi, '');
      if (cleaned === attrs) return match; // No change — avoid unnecessary churn
      const trimmed = cleaned.trim();
      return `<${tag}${trimmed ? ' ' + trimmed : ''}${selfClose ? ' /' : ''}>`;
    }
  );

  // --- Strip style attributes (can contain url() for tracking pixels) ------

  result = result.replace(
    /(<[a-zA-Z][^>]*?)\s+style\s*=\s*"[^"]*"/gi, '$1'
  );
  result = result.replace(
    /(<[a-zA-Z][^>]*?)\s+style\s*=\s*'[^']*'/gi, '$1'
  );
  result = result.replace(
    /(<[a-zA-Z][^>]*?)\s+style\s*=\s*[^\s>"']+/gi, '$1'
  );

  // --- Strip dangerous non-event attributes --------------------------------
  // These attributes can load external resources or exfiltrate data even
  // without JavaScript: srcset (loads images), background (deprecated but
  // functional), ping (sends POST on click), formaction (overrides form target).
  // Using attribute whitelist approach would be ideal but is too heavy —
  // stripping specific dangerous attrs is a good middle ground.

  const DANGEROUS_ATTRS = ['srcset', 'background', 'ping', 'formaction', 'poster', 'dynsrc', 'lowsrc'];
  for (const attr of DANGEROUS_ATTRS) {
    // Double-quoted
    result = result.replace(
      new RegExp(`(<[a-zA-Z][^>]*?)\\s+${attr}\\s*=\\s*"[^"]*"`, 'gi'), '$1'
    );
    // Single-quoted
    result = result.replace(
      new RegExp(`(<[a-zA-Z][^>]*?)\\s+${attr}\\s*=\\s*'[^']*'`, 'gi'), '$1'
    );
    // Unquoted
    result = result.replace(
      new RegExp(`(<[a-zA-Z][^>]*?)\\s+${attr}\\s*=\\s*[^\\s>"']+`, 'gi'), '$1'
    );
  }

  // --- Validate <img> src — only allow internal /img/ paths ----------------
  // Decode HTML entities before checking — browsers decode entities in
  // attribute values before resolving URLs (e.g. &#46;&#46; → ..)

  result = result.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const srcMatch =
      attrs.match(/src\s*=\s*"([^"]*)"/i) ||
      attrs.match(/src\s*=\s*'([^']*)'/i) ||
      attrs.match(/src\s*=\s*([^\s>"']+)/i);
    if (!srcMatch) return ''; // No src attribute — strip the tag
    const src = decodeHTMLEntities(srcMatch[1]).trim();
    if (src.includes('..')) return ''; // Path traversal — strip
    if (src.startsWith('/img/')) return match; // Internal path — safe
    return ''; // External or suspicious — strip entire tag
  });

  // --- Validate <a> href — strip dangerous protocols -----------------------
  // Decode HTML entities before checking — &#106;avascript: decodes to javascript:
  //
  // Two passes: first strip dangerous opening tags (catches unclosed tags too),
  // then clean up any orphaned </a> closing tags left behind.

  result = result.replace(
    /<a\b([^>]*)>/gi,
    (match, attrs) => {
      const hrefMatch =
        attrs.match(/href\s*=\s*"([^"]*)"/i) ||
        attrs.match(/href\s*=\s*'([^']*)'/i) ||
        attrs.match(/href\s*=\s*([^\s>"']+)/i);
      if (!hrefMatch) return match; // No href — keep as-is (named anchor)
      if (hasDangerousProtocol(hrefMatch[1])) {
        return ''; // Strip the opening tag (content preserved naturally)
      }
      return match;
    }
  );
  // Clean up orphaned </a> tags left after stripping dangerous opening tags.
  // This isn't strictly needed (</a> is harmless) but keeps output clean.
  // Only remove </a> tags that don't have a preceding <a> on the same line.
  // (Simple approach: just leave them — they're harmless in HTML.)

  // --- Sanitize markdown image syntax ![alt](url) -------------------------

  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    // Decode entities — CommonMark resolves entities in image destinations
    const decoded = decodeHTMLEntities(url).trim();
    if (decoded.includes('..')) return ''; // Path traversal — strip
    if (decoded.startsWith('/img/')) return match; // Internal — safe
    if (decoded.startsWith('#')) return match; // Anchor — safe
    return ''; // External URL — strip entirely
  });

  // --- Sanitize markdown link syntax [text](url) ---------------------------
  // Negative lookbehind (?<!!) ensures we don't re-process images.

  result = result.replace(
    /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text, url) => {
      // Decode + normalize — CommonMark spec decodes entities in link
      // destinations, browsers strip whitespace from protocol names
      if (hasDangerousProtocol(url)) {
        return text; // Strip the link, keep the text
      }
      return match; // Normal external URL — keep
    }
  );

  // --- Strip dangerous autolinks <javascript:...> -------------------------

  // Also catch entity-encoded protocols and whitespace-obfuscated protocols
  result = result.replace(/<([^>]+)>/g, (match, inner) => {
    if (hasDangerousProtocol(inner)) {
      return ''; // Strip the autolink
    }
    return match;
  });

  // --- Strip dangerous reference-style link definitions --------------------

  result = result.replace(
    /^\[([^\]]+)\]:\s*(.+)$/gim,
    (match, _label, url) => {
      // Decode + normalize — CommonMark resolves entities in link definitions
      if (hasDangerousProtocol(url)) {
        return ''; // Strip the entire definition
      }
      return match;
    }
  );

  // --- Restore preserved code blocks --------------------------------------

  result = result.replace(
    /\x00PRESERVED_(\d+)\x00/g,
    (_, idx) => preserved[parseInt(idx)]
  );

  return result;
}
