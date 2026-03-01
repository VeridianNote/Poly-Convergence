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

// Docusaurus lifecycle hook — fires after every route change
export function onRouteDidUpdate({location, previousLocation}) {
  // Small delay to let the DOM render
  setTimeout(createMobileTOC, 200);
}
