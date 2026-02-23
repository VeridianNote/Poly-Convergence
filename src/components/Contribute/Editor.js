/**
 * MDXEditor-based content editor for the Contribute page.
 *
 * Features:
 * - WYSIWYG + source markdown + diff toggle
 * - Save draft with visible throttle countdown
 * - Submit for review (creates PR)
 * - Abandon draft
 * - Content validation feedback
 * - PR status display
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  toolbarPlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  markdownShortcutPlugin,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  UndoRedo,
  DiffSourceToggleWrapper,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

import { saveDraft, submitForReview, abandonDraft, getStatus } from './api';

export default function Editor({
  user,
  initialTitle = '',
  initialBody = '',
  initialType = 'wiki',
  initialCategory = '',
  initialBranch = null,
  categories = [],
  config = {},
  onDraftSaved,
  onDraftAbandoned,
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [type, setType] = useState(initialType);
  const [category, setCategory] = useState(initialCategory);
  const [newSubcategory, setNewSubcategory] = useState('');
  const [showNewSubcategory, setShowNewSubcategory] = useState(false);
  const [branch, setBranch] = useState(initialBranch);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [prInfo, setPrInfo] = useState(null);
  const [throttleCountdown, setThrottleCountdown] = useState(0);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

  const editorRef = useRef(null);
  const countdownRef = useRef(null);

  const throttleSeconds = user?.isMod ? 0 : (config.draftSaveInterval || 60);

  // Expose editor state globally for JWT expiry recovery
  useEffect(() => {
    window.__editorTitle = title;
    window.__editorContent = body;
    window.__editorType = type;
    window.__editorCategory = category;
    window.__editorBranch = branch;
  }, [title, body, type, category, branch]);

  // Countdown timer for save throttle
  useEffect(() => {
    if (throttleCountdown > 0) {
      countdownRef.current = setInterval(() => {
        setThrottleCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(countdownRef.current);
  }, [throttleCountdown]);

  // Check PR status when branch is set
  useEffect(() => {
    if (branch) {
      getStatus(branch).then(status => {
        if (status.pr) {
          setPrInfo(status.pr);
        }
        if (status.behindMain) {
          setStatusMessage('The published version has been updated since your last edit.');
        }
      }).catch(() => {});
    }
  }, [branch]);

  const handleEditorChange = useCallback((markdown) => {
    setBody(markdown);
  }, []);

  const handleSave = async () => {
    setErrors([]);
    setSaving(true);

    try {
      const result = await saveDraft({
        title,
        body,
        type,
        category,
        subcategory: showNewSubcategory ? slugifyCategory(newSubcategory) : undefined,
        existingBranch: branch || undefined,
      });

      if (!result.ok) {
        if (result.errors) {
          setErrors(result.errors);
        } else if (result.code === 'THROTTLED') {
          setThrottleCountdown(result.waitSeconds);
        } else if (result.code === 'PENDING_LIMIT') {
          setErrors([result.error]);
        } else {
          setErrors([result.error || 'Failed to save draft']);
        }
        return;
      }

      setBranch(result.branch);
      setThrottleCountdown(throttleSeconds);
      setStatusMessage(`Draft saved at ${new Date().toLocaleTimeString()}`);

      if (onDraftSaved) onDraftSaved(result);
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!branch) {
      setErrors(['Save your draft before submitting.']);
      return;
    }

    setShowSubmitConfirm(false);
    setSubmitting(true);
    setErrors([]);

    try {
      const result = await submitForReview(branch);

      if (!result.ok) {
        setErrors([result.error || 'Failed to submit']);
        return;
      }

      setPrInfo(result.pr);
      setStatusMessage('Submitted for review!');
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAbandon = async () => {
    if (!branch) return;

    setShowAbandonConfirm(false);

    try {
      await abandonDraft(branch);
      setBranch(null);
      setTitle('');
      setBody('');
      setPrInfo(null);
      setStatusMessage('Draft abandoned.');
      if (onDraftAbandoned) onDraftAbandoned();
    } catch (err) {
      setErrors([err.message]);
    }
  };

  const saveDisabled = saving || throttleCountdown > 0 || !title.trim() || !body.trim();
  const submitDisabled = submitting || !branch || (prInfo && prInfo.state === 'open');

  return (
    <div className="editor-container">
      {/* Content type selector (only for new drafts) */}
      {!branch && (
        <div className="editor-type-selector" style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button
            className={`button button--sm ${type === 'wiki' ? 'button--primary' : 'button--outline button--primary'}`}
            onClick={() => setType('wiki')}
          >
            New Wiki Page
          </button>
          <button
            className={`button button--sm ${type === 'blog' ? 'button--primary' : 'button--outline button--primary'}`}
            onClick={() => setType('blog')}
          >
            New Blog Post
          </button>
        </div>
      )}

      {/* Title */}
      <div style={{ marginBottom: '1rem' }}>
        <input
          data-editor-title
          type="text"
          placeholder="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          disabled={!!branch && !!prInfo}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontSize: '1.25rem',
            border: '1px solid var(--ifm-color-emphasis-300)',
            borderRadius: '4px',
            fontWeight: 600,
          }}
        />
      </div>

      {/* Location breadcrumb (shows where this page will live) */}
      {branch && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.5rem 0.75rem',
          fontSize: '0.85rem',
          color: 'var(--ifm-color-emphasis-600)',
          backgroundColor: 'var(--ifm-color-emphasis-100)',
          borderRadius: '4px',
          fontFamily: 'var(--ifm-font-family-monospace)',
        }}>
          {type === 'blog' ? '📝 Blog Post' : `📄 Wiki → ${formatCategoryLabel(category)}`}
          {' · '}
          <span style={{ color: 'var(--ifm-color-emphasis-500)' }}>
            {branch.split('/').pop()}
          </span>
        </div>
      )}

      {/* Category selector (wiki only, new drafts only) */}
      {type === 'wiki' && !branch && (
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select
            value={category}
            onChange={e => {
              setCategory(e.target.value);
              setShowNewSubcategory(false);
            }}
            style={{
              padding: '0.5rem',
              border: '1px solid var(--ifm-color-emphasis-300)',
              borderRadius: '4px',
            }}
          >
            <option value="">Select category...</option>
            {categories.map(cat => (
              <option key={cat.name} value={cat.name}>{cat.label}</option>
            ))}
          </select>

          {category && (
            <button
              className="button button--sm button--outline button--secondary"
              onClick={() => setShowNewSubcategory(!showNewSubcategory)}
            >
              {showNewSubcategory ? 'Cancel' : '+ New subcategory'}
            </button>
          )}

          {showNewSubcategory && (
            <input
              type="text"
              placeholder="Subcategory name (e.g., communication)"
              value={newSubcategory}
              onChange={e => setNewSubcategory(e.target.value)}
              style={{
                padding: '0.5rem',
                border: '1px solid var(--ifm-color-emphasis-300)',
                borderRadius: '4px',
                flex: 1,
              }}
            />
          )}
        </div>
      )}

      {/* MDXEditor */}
      <div style={{
        border: '1px solid var(--ifm-color-emphasis-300)',
        borderRadius: '4px',
        marginBottom: '1rem',
        minHeight: '400px',
      }}>
        <MDXEditor
          ref={editorRef}
          markdown={initialBody}
          onChange={handleEditorChange}
          plugins={[
            headingsPlugin(),
            listsPlugin(),
            quotePlugin(),
            thematicBreakPlugin(),
            linkPlugin(),
            linkDialogPlugin(),
            tablePlugin(),
            codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
            codeMirrorPlugin({
              codeBlockLanguages: {
                '': 'Plain text',
                js: 'JavaScript',
                css: 'CSS',
                html: 'HTML',
                python: 'Python',
              },
            }),
            diffSourcePlugin({ viewMode: 'rich-text' }),
            markdownShortcutPlugin(),
            toolbarPlugin({
              toolbarContents: () => (
                <DiffSourceToggleWrapper>
                  <UndoRedo />
                  <BlockTypeSelect />
                  <BoldItalicUnderlineToggles />
                  <CreateLink />
                  <InsertTable />
                  <ListsToggle />
                  <InsertThematicBreak />
                </DiffSourceToggleWrapper>
              ),
            }),
          ]}
          contentEditableClassName="editor-content-area"
        />
      </div>

      {/* Error messages */}
      {errors.length > 0 && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: 'var(--ifm-color-danger-contrast-background)',
          border: '1px solid var(--ifm-color-danger-dark)',
          borderRadius: '4px',
          color: 'var(--ifm-color-danger-darkest)',
        }}>
          {errors.map((err, i) => (
            <div key={i}>{err}</div>
          ))}
        </div>
      )}

      {/* Status message */}
      {statusMessage && (
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '1rem',
          color: 'var(--ifm-color-emphasis-700)',
          fontSize: '0.9rem',
        }}>
          {statusMessage}
        </div>
      )}

      {/* PR Status */}
      {prInfo && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: 'var(--ifm-color-info-contrast-background)',
          border: '1px solid var(--ifm-color-info-dark)',
          borderRadius: '4px',
        }}>
          <strong>Submission status:</strong> {prInfo.state === 'open' ? 'In Review' : prInfo.state}
          {prInfo.labels?.length > 0 && (
            <span style={{ marginLeft: '0.5rem' }}>
              {prInfo.labels.map(l => (
                <span key={l} style={{
                  display: 'inline-block',
                  padding: '0.1rem 0.4rem',
                  marginLeft: '0.25rem',
                  fontSize: '0.8rem',
                  borderRadius: '3px',
                  backgroundColor: 'var(--ifm-color-emphasis-200)',
                }}>
                  {l}
                </span>
              ))}
            </span>
          )}
          {prInfo.changesRequested && (
            <div style={{ marginTop: '0.25rem', color: 'var(--ifm-color-warning-darkest)' }}>
              Changes have been requested. Edit your draft and save to update the PR.
            </div>
          )}
          {prInfo.url && (
            <div style={{ marginTop: '0.25rem' }}>
              <a href={prInfo.url} target="_blank" rel="noopener noreferrer">
                View PR on GitHub
              </a>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          className="button button--primary"
          onClick={handleSave}
          disabled={saveDisabled}
        >
          {saving
            ? 'Saving...'
            : throttleCountdown > 0
              ? `Save Draft (${formatCountdown(throttleCountdown)})`
              : 'Save Draft'
          }
        </button>

        <button
          className="button button--success"
          onClick={() => setShowSubmitConfirm(true)}
          disabled={submitDisabled}
        >
          {submitting ? 'Submitting...' : 'Submit for Review'}
        </button>

        {branch && (
          <button
            className="button button--outline button--danger"
            onClick={() => setShowAbandonConfirm(true)}
          >
            Abandon
          </button>
        )}
      </div>

      {/* Submit confirmation dialog */}
      {showSubmitConfirm && (
        <ConfirmDialog
          title="Submit for Review?"
          message="Your draft will be submitted as a pull request for moderator review. You can still make changes after submitting."
          onConfirm={handleSubmit}
          onCancel={() => setShowSubmitConfirm(false)}
          confirmLabel="Submit"
        />
      )}

      {/* Abandon confirmation dialog */}
      {showAbandonConfirm && (
        <ConfirmDialog
          title="Abandon Draft?"
          message="This will delete your draft and free up an editing slot. This cannot be undone."
          onConfirm={handleAbandon}
          onCancel={() => setShowAbandonConfirm(false)}
          confirmLabel="Abandon"
          confirmDanger
        />
      )}
    </div>
  );
}

/**
 * Simple confirmation dialog component.
 */
function ConfirmDialog({ title, message, onConfirm, onCancel, confirmLabel, confirmDanger }) {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'var(--ifm-background-color)',
        padding: '2rem',
        borderRadius: '8px',
        maxWidth: '400px',
        width: '90%',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p>{message}</p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="button button--outline button--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`button ${confirmDanger ? 'button--danger' : 'button--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Format seconds into M:SS.
 */
function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Format a category slug into a human-readable label.
 * e.g., "foundational-concepts" → "Foundational Concepts"
 */
function formatCategoryLabel(cat) {
  if (!cat) return 'Uncategorized';
  return cat
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Slugify a subcategory name.
 */
function slugifyCategory(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
