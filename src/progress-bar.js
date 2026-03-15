// =============================================
// Reading progress bar — runs once on module load
// =============================================
if (typeof window !== 'undefined') {
  const bar = document.createElement('div');
  bar.id = 'reading-progress';
  document.body.prepend(bar);

  const updateProgressBar = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = h > 0 ? (window.scrollY / h * 100) + '%' : '0%';
  };

  window.addEventListener('scroll', updateProgressBar, { passive: true });
  window.addEventListener('resize', updateProgressBar, { passive: true });
  updateProgressBar();

  // Recalculate when collapsible elements toggle (changes page height)
  new MutationObserver(updateProgressBar).observe(document.body, {
    attributes: true, subtree: true, attributeFilter: ['open', 'data-collapsed']
  });

  // Animated close for mobile TOC <details> elements.
  // Intercepts the summary click when closing, plays CSS slide-up
  // animation, then removes the open attribute.
  function animatedClose(details) {
    details.classList.add('closing');
    details.addEventListener('animationend', function handler() {
      details.removeEventListener('animationend', handler);
      details.classList.remove('closing');
      details.removeAttribute('open');
    }, { once: true });
  }

  // Intercept summary clicks on mobile TOC for animated close
  // Also handles share link clicks and engagement bar clicks
  document.addEventListener('click', (e) => {
    const summary = e.target.closest('.mobile-toc summary');
    if (summary) {
      const details = summary.closest('details');
      if (details && details.open) {
        e.preventDefault();
        animatedClose(details);
      }
      return;
    }

    // Handle share link clicks (in any TOC — mobile or desktop)
    const shareLink = e.target.closest('.toc-share-link');
    if (shareLink) {
      e.preventDefault();
      navigator.clipboard.writeText(window.location.origin + window.location.pathname).then(() => {
        const original = shareLink.innerHTML;
        shareLink.innerHTML = '\u2714 Link copied!';
        shareLink.classList.add('toc-share-link--done');
        showToast('\uD83D\uDD17 Link copied to clipboard!');
        spawnConfettiFromBottom();
        // Close mobile TOC if open
        const details = shareLink.closest('details');
        if (details && details.open) {
          animatedClose(details);
        }
        // Track share in API
        trackReaction('share');
        setTimeout(() => {
          shareLink.innerHTML = original;
          shareLink.classList.remove('toc-share-link--done');
        }, 2500);
      });
      return;
    }

    // Close mobile TOC when a link is clicked + smooth scroll
    const link = e.target.closest('.mobile-toc a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    e.preventDefault();

    const target = document.getElementById(href.slice(1));
    if (!target) return;

    const details = link.closest('details');
    if (details && details.open) {
      animatedClose(details);
      setTimeout(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        updateProgressBar();
      }, 250);
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, true);
}

// =============================================
// API helper — resolve the Worker API URL
// =============================================
function getApiUrl() {
  // Docusaurus injects customFields into the global site config
  try {
    // At runtime, we can read it from the meta tag or fallback
    const meta = document.querySelector('meta[name="api-url"]');
    if (meta) return meta.getAttribute('content');
  } catch {}
  // Fallback: production URL (works for deployed site)
  // In dev, the Worker runs at localhost:8787
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:8787';
  }
  return 'https://api.polyconvergence.com';
}

// =============================================
// Engagement tracking — localStorage dedup + API
// =============================================
function getPageSlug() {
  return window.location.pathname;
}

function hasReacted(type) {
  try {
    const key = `reaction:${type}:${getPageSlug()}`;
    return localStorage.getItem(key) === '1';
  } catch { return false; }
}

function markReacted(type) {
  try {
    const key = `reaction:${type}:${getPageSlug()}`;
    localStorage.setItem(key, '1');
  } catch {}
}

async function trackReaction(type) {
  const slug = getPageSlug();
  // Always mark locally even if API fails
  markReacted(type);
  try {
    await fetch(getApiUrl() + '/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, type }),
    });
  } catch {}
}

async function fetchReactions(slug) {
  try {
    const res = await fetch(getApiUrl() + '/api/reactions?slug=' + encodeURIComponent(slug));
    if (res.ok) return await res.json();
  } catch {}
  return { likes: 0, shares: 0 };
}

// =============================================
// Toast notification
// =============================================
let _toastTimer = null;
function showToast(message) {
  // Reuse existing toast if present — just update text and reset timer
  let toast = document.querySelector('.share-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'share-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('share-toast--visible');

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('share-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 2200);
}

// =============================================
// Confetti animation
// =============================================
const confettiEmoji = ['\uD83C\uDF89', '\u2764\uFE0F', '\uD83D\uDE4C', '\u2728', '\uD83D\uDC9C', '\uD83C\uDF1F', '\uD83D\uDE0D', '\uD83D\uDCAB', '\uD83E\uDD84', '\uD83D\uDC09', '\uD83D\uDC9C'];

function spawnConfetti(container) {
  const delays = confettiEmoji.map((_, i) => i * (50 + Math.random() * 80));
  // Shuffle delays (Fisher-Yates)
  for (let j = delays.length - 1; j > 0; j--) {
    const k = Math.floor(Math.random() * (j + 1));
    [delays[j], delays[k]] = [delays[k], delays[j]];
  }
  const laneWidth = 20 / confettiEmoji.length;
  for (let i = 0; i < confettiEmoji.length; i++) {
    const emoji = document.createElement('span');
    emoji.className = 'share-confetti';
    emoji.textContent = confettiEmoji[i];
    emoji.style.left = (40 + laneWidth * i + (Math.random() * 4 - 2)) + '%';
    emoji.style.animationDelay = delays[i] + 'ms';
    emoji.style.animationDuration = (0.8 + Math.random() * 0.5) + 's';
    emoji.style.setProperty('--drift', (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 20) + 'px');
    container.appendChild(emoji);
    emoji.addEventListener('animationend', () => emoji.remove());
  }
}

function spawnConfettiFromBottom() {
  const container = document.createElement('div');
  container.className = 'share-confetti-viewport';
  document.body.appendChild(container);
  spawnConfetti(container);
  setTimeout(() => container.remove(), 2500);
}

// =============================================
// Engagement bar — thumbs up + share buttons
// =============================================
function createEngagementBar() {
  if (typeof document === 'undefined') return;

  // Remove any previous engagement bar
  document.querySelectorAll('.engage-bar').forEach(el => el.remove());

  // Don't create on homepage or non-content pages
  const path = window.location.pathname;
  if (path === '/' || path === '/contribute' || path === '/about' || path === '/disclaimer') return;

  const container = document.querySelector('article') || document.querySelector('.markdown');
  if (!container) return;

  const slug = getPageSlug();
  const alreadyLiked = hasReacted('like');
  const alreadyShared = hasReacted('share');

  // Create the engagement bar
  const bar = document.createElement('div');
  bar.className = 'engage-bar';

  // Thumbs up button
  const likeBtn = document.createElement('button');
  likeBtn.className = 'engage-btn engage-btn--like' + (alreadyLiked ? ' engage-btn--done' : '');
  likeBtn.innerHTML = '<span class="engage-btn__icon">\uD83D\uDC4D</span> <span class="engage-btn__text">' +
    (alreadyLiked ? 'Liked!' : 'Like this') + '</span>' +
    '<span class="engage-btn__count" style="display:none"></span>';
  likeBtn.setAttribute('aria-label', 'Like this page');

  likeBtn.addEventListener('click', () => {
    const wasAlreadyLiked = likeBtn.classList.contains('engage-btn--done');
    likeBtn.classList.add('engage-btn--done');
    likeBtn.querySelector('.engage-btn__icon').textContent = '\u2764\uFE0F';
    likeBtn.querySelector('.engage-btn__text').textContent = 'Liked!';
    showToast('\u2764\uFE0F Thanks for the Love!');
    spawnConfetti(bar);
    // Only track once — subsequent clicks are just for the confetti fun
    if (!wasAlreadyLiked) {
      trackReaction('like').then(() => {
        updateCountDisplay(likeBtn.querySelector('.engage-btn__count'), 'like', 1);
      });
    }
  });

  // Share button
  const shareBtn = document.createElement('button');
  shareBtn.className = 'engage-btn engage-btn--share';
  shareBtn.innerHTML = '<span class="engage-btn__icon">\uD83D\uDD17</span> <span class="engage-btn__text">Share</span>' +
    '<span class="engage-btn__count" style="display:none"></span>';
  shareBtn.setAttribute('aria-label', 'Copy link to clipboard');

  shareBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.origin + window.location.pathname).then(() => {
      const iconEl = shareBtn.querySelector('.engage-btn__icon');
      const textEl = shareBtn.querySelector('.engage-btn__text');
      shareBtn.classList.add('engage-btn--done');
      iconEl.textContent = '\u2714';
      textEl.textContent = 'Link copied!';
      showToast('\uD83D\uDD17 Link copied to clipboard!');
      spawnConfetti(bar);
      trackReaction('share').then(() => {
        updateCountDisplay(shareBtn.querySelector('.engage-btn__count'), 'share', 1);
      });
      setTimeout(() => {
        shareBtn.classList.remove('engage-btn--done');
        iconEl.textContent = '\uD83D\uDD17';
        textEl.textContent = 'Share';
      }, 2500);
    });
  });

  bar.appendChild(likeBtn);
  bar.appendChild(shareBtn);

  // Insert before the last <hr> (above closing sections) or at end
  const hrs = container.querySelectorAll('hr');
  const lastHr = hrs.length > 0 ? hrs[hrs.length - 1] : null;
  if (lastHr) {
    lastHr.parentNode.insertBefore(bar, lastHr);
  } else {
    container.appendChild(bar);
  }

  // Fetch counts from API and show if above threshold
  fetchReactions(slug).then(data => {
    updateCountDisplay(likeBtn.querySelector('.engage-btn__count'), 'like', 0, data.likes);
    updateCountDisplay(shareBtn.querySelector('.engage-btn__count'), 'share', 0, data.shares);
  });
}

/**
 * Update a count badge. Shows only if total >= 10.
 * @param {HTMLElement} el - The count span
 * @param {string} type - 'like' or 'share'
 * @param {number} increment - How much was just added locally
 * @param {number} serverCount - Count from server (optional)
 */
function updateCountDisplay(el, type, increment, serverCount) {
  if (!el) return;
  const THRESHOLD = 10;

  if (serverCount !== undefined) {
    const total = serverCount + increment;
    if (total >= THRESHOLD) {
      el.textContent = total;
      el.style.display = '';
    }
  } else {
    // Increment existing displayed count
    const current = parseInt(el.textContent) || 0;
    if (current > 0) {
      el.textContent = current + increment;
    }
  }
}

// =============================================
// Auto-generated mobile TOC
// =============================================
function createMobileTOC() {
  if (typeof document === 'undefined') return;

  // Remove any previous auto-generated TOC
  document.querySelectorAll('.mobile-toc-auto').forEach(el => el.remove());

  // Don't create on homepage
  if (window.location.pathname === '/') return;

  // Hide Docusaurus built-in mobile TOC so we use ours everywhere
  document.querySelectorAll('[class*="tocMobile"]').forEach(el => {
    el.style.display = 'none';
  });

  // Find the content container
  const container = document.querySelector('article') || document.querySelector('.markdown');
  if (!container) return;

  // Find h2 and h3 headings with IDs
  const headings = container.querySelectorAll('h2[id], h3[id]');
  if (headings.length < 2) return;

  // Build nested TOC list (h3s nest under preceding h2)
  const ul = document.createElement('ul');
  let currentH2Li = null;

  headings.forEach(h => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + h.id;
    a.textContent = h.textContent;
    li.appendChild(a);

    if (h.tagName === 'H2') {
      ul.appendChild(li);
      currentH2Li = li;
    } else if (h.tagName === 'H3' && currentH2Li) {
      let subUl = currentH2Li.querySelector('ul');
      if (!subUl) {
        subUl = document.createElement('ul');
        currentH2Li.appendChild(subUl);
      }
      subUl.appendChild(li);
    } else {
      ul.appendChild(li);
    }
  });

  // Add share link as last TOC entry
  const shareLi = document.createElement('li');
  shareLi.className = 'toc-share-item';
  const shareLink = document.createElement('a');
  shareLink.href = '#';
  shareLink.className = 'toc-share-link';
  shareLink.innerHTML = '\uD83D\uDD17 Share this page';
  shareLi.appendChild(shareLink);
  ul.appendChild(shareLi);

  // Create the details/summary wrapper
  const details = document.createElement('details');
  details.className = 'mobile-toc mobile-toc-auto';

  const summary = document.createElement('summary');
  summary.textContent = 'On this page';
  details.appendChild(summary);
  details.appendChild(ul);

  // Insert into the page
  // Blog posts: after the header (title/author/date)
  // Doc pages: at the top of the article
  const header = container.querySelector('header');
  if (header && header.nextSibling) {
    header.parentNode.insertBefore(details, header.nextSibling);
  } else {
    container.insertBefore(details, container.firstChild);
  }
}

// =============================================
// Desktop sidebar TOC — inject share link
// =============================================
function injectDesktopShareLink() {
  if (typeof document === 'undefined') return;

  // Remove any previous injected share links in desktop TOC
  document.querySelectorAll('.desktop-toc-share').forEach(el => el.remove());

  // Don't inject on homepage
  if (window.location.pathname === '/') return;

  // Find the Docusaurus desktop sidebar TOC
  const tocContainer = document.querySelector('[class*="tableOfContents"]');
  if (!tocContainer) return;
  const tocUl = tocContainer.querySelector('ul');
  if (!tocUl) return;

  const li = document.createElement('li');
  li.className = 'desktop-toc-share';
  const a = document.createElement('a');
  a.href = '#';
  a.className = 'toc-share-link table-of-contents__link';
  a.innerHTML = '\uD83D\uDD17 Share this page';
  li.appendChild(a);
  tocUl.appendChild(li);
}

/**
 * Add a license indicator at the bottom of blog/stories posts.
 * Checks for a hidden comment <!-- license: all-rights-reserved --> in the article
 * to determine the license type. Defaults to CC BY-NC-SA 4.0.
 */
function createLicenseIndicator() {
  if (typeof document === 'undefined') return;

  // Remove any previous indicator
  document.querySelectorAll('.blog-license-indicator').forEach(el => el.remove());

  // Only on individual story pages (not listing, not other pages)
  const path = window.location.pathname;
  if (!path.startsWith('/stories/') || path === '/stories/' || path === '/stories') return;

  const container = document.querySelector('article') || document.querySelector('.markdown');
  if (!container) return;

  // Check for all-rights-reserved marker in the HTML
  const html = container.innerHTML;
  const isAllRights = html.includes('<!-- license: all-rights-reserved -->');

  const indicator = document.createElement('div');
  indicator.className = 'blog-license-indicator';

  if (isAllRights) {
    indicator.innerHTML = '\uD83D\uDD12 \u00A9 All Rights Reserved \u00B7 ' +
      '<a href="/terms-of-contribution">Terms</a>';
  } else {
    indicator.innerHTML = '\uD83C\uDF10 Licensed under ' +
      '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a>' +
      ' \u00B7 <a href="/terms-of-contribution">Terms</a>';
  }

  container.appendChild(indicator);
}

// Docusaurus lifecycle hook — fires after every route change
export function onRouteDidUpdate({location, previousLocation}) {
  // Small delay to let the DOM render
  setTimeout(createMobileTOC, 200);
  setTimeout(createEngagementBar, 300);
  setTimeout(injectDesktopShareLink, 300);
  setTimeout(createLicenseIndicator, 350);
}
