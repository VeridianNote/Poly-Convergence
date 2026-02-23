/**
 * /contribute page — Community contribution editor.
 *
 * Handles:
 * - Auth state (login/logout, session display)
 * - Draft list management (view existing drafts, start new ones)
 * - Editor state recovery after JWT expiry
 * - Submissions disabled message
 *
 * Uses <BrowserOnly> to wrap MDXEditor since it requires browser APIs
 * and Docusaurus does SSR.
 */

import React, { useState, useEffect } from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Heading from '@theme/Heading';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

function ContributePage() {
  const { siteConfig } = useDocusaurusContext();

  // Set the API URL from Docusaurus config so the api.js client picks it up.
  // This enables local dev (API_URL=http://localhost:8787) without code changes.
  if (typeof window !== 'undefined' && siteConfig.customFields?.apiUrl) {
    window.__POLY_API_URL = window.__POLY_API_URL || siteConfig.customFields.apiUrl;
  }

  return (
    <Layout
      title="Contribute"
      description="Submit wiki pages and blog posts for community review"
    >
      <main style={{ padding: '2rem 0' }}>
        <div className="container">
          <Heading as="h1">Contribute</Heading>
          <BrowserOnly fallback={<div>Loading editor...</div>}>
            {() => <ContributeApp />}
          </BrowserOnly>
        </div>
      </main>
    </Layout>
  );
}

/**
 * The main contribute app — only runs in the browser.
 */
function ContributeApp() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = not logged in
  const [config, setConfig] = useState(null);
  const [categories, setCategories] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [activeDraft, setActiveDraft] = useState(null);
  const [view, setView] = useState('list'); // 'list' | 'editor'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editorType, setEditorType] = useState('wiki');

  // Lazy import the API and Editor (they use browser-only APIs)
  const apiRef = React.useRef(null);
  const EditorRef = React.useRef(null);

  useEffect(() => {
    async function init() {
      try {
        // Dynamic imports for browser-only modules
        const api = await import('../components/Contribute/api');
        const editorModule = await import('../components/Contribute/Editor');
        apiRef.current = api;
        EditorRef.current = editorModule.default;

        // Check for auth error from OAuth callback redirect
        const params = new URLSearchParams(window.location.search);
        const authError = params.get('auth_error');
        if (authError) {
          setError(`Sign-in failed: ${authError}`);
          // Clean the URL
          window.history.replaceState({}, '', window.location.pathname);
          setLoading(false);
          return;
        }

        // Load config first (doesn't require auth)
        const configData = await api.getConfig();
        setConfig(configData);

        // Load user info
        const userData = await api.getUser();
        setUser(userData);

        if (userData) {
          // Load categories and drafts in parallel
          const [cats, userDrafts] = await Promise.all([
            api.getCategories(),
            api.listDrafts(),
          ]);
          setCategories(cats);
          setDrafts(userDrafts);

          // Clear auth redirect timestamp on successful login
          localStorage.removeItem('poly_auth_redirect_at');

          // Check for editor recovery (JWT expiry mid-edit)
          const recovery = api.checkEditorRecovery();
          if (recovery) {
            setActiveDraft({
              title: recovery.title,
              body: recovery.body,
              type: recovery.type,
              category: recovery.category,
              branch: recovery.branch || null,
            });
            setView('editor');
          }

          // Check for ?edit= parameter (editing existing page)
          const params = new URLSearchParams(window.location.search);
          const editPath = params.get('edit');
          if (editPath) {
            setActiveDraft({
              editPath,
              title: '',
              body: '',
              type: editPath.startsWith('blog/') ? 'blog' : 'wiki',
              category: '',
              branch: null,
            });
            setView('editor');
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  const handleLogin = () => {
    if (apiRef.current) {
      window.location.href = apiRef.current.getLoginUrl();
    }
  };

  const handleLogout = async () => {
    if (apiRef.current) {
      await apiRef.current.logout();
    }
  };

  const handleOpenDraft = async (draft) => {
    try {
      const data = await apiRef.current.loadDraft(draft.branch);
      setActiveDraft({
        title: data.title,
        body: data.body,
        type: data.type,
        category: data.category || '',
        branch: draft.branch,
        pr: data.pr,
      });
      setView('editor');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleNewDraft = (type) => {
    setEditorType(type);
    setActiveDraft({
      title: '',
      body: '',
      type,
      category: '',
      branch: null,
    });
    setView('editor');
  };

  const handleBackToList = async () => {
    setView('list');
    setActiveDraft(null);
    // Refresh drafts list
    if (apiRef.current && user) {
      try {
        const userDrafts = await apiRef.current.listDrafts();
        setDrafts(userDrafts);
      } catch {
        // Silently keep stale list — user can refresh the page if needed
      }
    }
  };

  // When a draft is saved, update the active draft's branch (for first saves)
  // without navigating away from the editor.
  const handleDraftSaved = (result) => {
    if (result.branch) {
      setActiveDraft(prev => prev ? { ...prev, branch: result.branch } : prev);
    }
  };

  // Loading state
  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>;
  }

  // Error state
  if (error) {
    return (
      <div style={{
        padding: '1rem',
        backgroundColor: 'var(--ifm-color-danger-contrast-background)',
        border: '1px solid var(--ifm-color-danger-dark)',
        borderRadius: '4px',
      }}>
        <strong>Error:</strong> {error}
      </div>
    );
  }

  // Submissions disabled
  if (config && !config.submissionsEnabled && (!user || !user.isMod)) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '3rem',
        backgroundColor: 'var(--ifm-color-warning-contrast-background)',
        borderRadius: '8px',
      }}>
        <Heading as="h2">Submissions Temporarily Paused</Heading>
        <p>Community submissions are temporarily paused. Check back soon.</p>
        <p>In the meantime, you can browse the <a href="/docs/intro">Wiki</a> and <a href="/blog">Blog</a>.</p>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <Heading as="h2">Sign in to Contribute</Heading>
        <p style={{ marginBottom: '1.5rem', color: 'var(--ifm-color-emphasis-700)' }}>
          Sign in with your GitHub account to submit wiki pages and blog posts
          for community review. No Git knowledge required.
        </p>
        <button className="button button--primary button--lg" onClick={handleLogin}>
          Sign in with GitHub
        </button>
        <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--ifm-color-emphasis-600)' }}>
          We only request your public profile — no access to your repositories.
        </p>
      </div>
    );
  }

  // Editor view
  if (view === 'editor' && activeDraft && EditorRef.current) {
    const EditorComponent = EditorRef.current;
    return (
      <div>
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button className="button button--outline button--secondary button--sm" onClick={handleBackToList}>
            &larr; Back to drafts
          </button>
          <UserBadge user={user} onLogout={handleLogout} />
        </div>
        <EditorComponent
          user={user}
          initialTitle={activeDraft.title}
          initialBody={activeDraft.body}
          initialType={activeDraft.type}
          initialCategory={activeDraft.category}
          initialBranch={activeDraft.branch}
          categories={categories}
          config={config}
          onDraftSaved={handleDraftSaved}
          onDraftAbandoned={handleBackToList}
        />
      </div>
    );
  }

  // Draft list view (default)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <p style={{ margin: 0, color: 'var(--ifm-color-emphasis-700)' }}>
            {user.tier === 'new' && `New contributor — ${user.maxPending} pending edit allowed`}
            {user.tier === 'trusted' && `Trusted contributor — up to ${user.maxPending} pending edits`}
            {user.tier === 'mod' && 'Moderator — unlimited edits'}
          </p>
        </div>
        <UserBadge user={user} onLogout={handleLogout} />
      </div>

      {/* New draft buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem' }}>
        <button
          className="button button--primary"
          onClick={() => handleNewDraft('wiki')}
          disabled={!user.isMod && user.pendingCount >= user.maxPending}
        >
          New Wiki Page
        </button>
        <button
          className="button button--primary"
          onClick={() => handleNewDraft('blog')}
          disabled={!user.isMod && user.pendingCount >= user.maxPending}
        >
          New Blog Post
        </button>
        {user.isMod && (
          <a href="/contribute/admin" className="button button--outline button--secondary">
            Admin Panel
          </a>
        )}
      </div>

      {/* Pending limit warning */}
      {!user.isMod && user.pendingCount >= user.maxPending && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: 'var(--ifm-color-warning-contrast-background)',
          border: '1px solid var(--ifm-color-warning-dark)',
          borderRadius: '4px',
        }}>
          You&apos;ve reached your limit of {user.maxPending} pending edit(s). Finish or abandon an existing draft to start a new one.
        </div>
      )}

      {/* Drafts list */}
      <Heading as="h2">Your Drafts</Heading>
      {drafts.length === 0 ? (
        <p style={{ color: 'var(--ifm-color-emphasis-600)' }}>
          No drafts yet. Click &quot;New Wiki Page&quot; or &quot;New Blog Post&quot; to get started.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {drafts.map(draft => (
            <DraftCard key={draft.branch} draft={draft} onOpen={() => handleOpenDraft(draft)} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * User avatar badge with logout button.
 */
function UserBadge({ user, onLogout }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      {user.avatar && (
        <img
          src={user.avatar}
          alt={user.username}
          style={{ width: 28, height: 28, borderRadius: '50%' }}
        />
      )}
      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{user.username}</span>
      {user.isMod && (
        <span style={{
          fontSize: '0.7rem',
          padding: '0.1rem 0.3rem',
          borderRadius: '3px',
          backgroundColor: 'var(--ifm-color-primary)',
          color: '#fff',
        }}>
          MOD
        </span>
      )}
      <button
        className="button button--outline button--sm"
        onClick={onLogout}
        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
      >
        Sign out
      </button>
    </div>
  );
}

/**
 * Card showing a draft's info.
 */
function DraftCard({ draft, onOpen }) {
  const slug = draft.slug || draft.branch.split('/').pop();
  const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div
      style={{
        padding: '1rem',
        border: '1px solid var(--ifm-color-emphasis-300)',
        borderRadius: '6px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
      }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div>
        <strong>{title}</strong>
        <div style={{ fontSize: '0.85rem', color: 'var(--ifm-color-emphasis-600)', marginTop: '0.25rem' }}>
          {draft.hasPR ? (
            <>
              PR #{draft.prNumber} — {draft.prState === 'open' ? 'In Review' : draft.prState}
              {draft.prLabels?.map(l => (
                <span key={l} style={{
                  marginLeft: '0.25rem',
                  padding: '0.05rem 0.3rem',
                  fontSize: '0.75rem',
                  borderRadius: '3px',
                  backgroundColor: 'var(--ifm-color-emphasis-200)',
                }}>
                  {l}
                </span>
              ))}
            </>
          ) : (
            'Draft — not yet submitted'
          )}
        </div>
      </div>
      <span style={{ fontSize: '0.85rem', color: 'var(--ifm-color-primary)' }}>&rarr;</span>
    </div>
  );
}

export default ContributePage;
