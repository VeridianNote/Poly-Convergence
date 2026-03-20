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
  imagePlugin,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  ListsToggle,
  UndoRedo,
  DiffSourceToggleWrapper,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

import { marked } from 'marked';
import { saveDraft, submitForReview, abandonDraft, getStatus, uploadImage, mergeBranch, getAuthorProfile, saveAuthorProfile, listImages, deleteImage } from './api';

export default function Editor({
  user,
  initialTitle = '',
  initialBody = '',
  initialType = 'wiki',
  initialCategory = '',
  initialBranch = null,
  initialEditPath = null,
  initialPrImagesApproved = false,
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
  const [selectedTags, setSelectedTags] = useState([]);
  const [branch, setBranch] = useState(initialBranch);
  const [editPath] = useState(initialEditPath);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [prInfo, setPrInfo] = useState(null);
  const [throttleCountdown, setThrottleCountdown] = useState(0);
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [behindMain, setBehindMain] = useState(false);
  const [merging, setMerging] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState(null);
  const [prImagesApproved, setPrImagesApproved] = useState(initialPrImagesApproved);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const [authorProfile, setAuthorProfile] = useState(null);
  const [authorProfileDirty, setAuthorProfileDirty] = useState(false);
  const [license, setLicense] = useState('cc-by-nc-sa');
  const [showLicenseHelp, setShowLicenseHelp] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [deletingImage, setDeletingImage] = useState(null); // path of image being deleted (for confirmation)
  const [imagesRefreshing, setImagesRefreshing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

  const editorRef = useRef(null);
  const countdownRef = useRef(null);
  const branchRef = useRef(branch);
  const savingRef = useRef(false); // Synchronous guard against double-click race

  const throttleSeconds = user?.isMod ? 0 : (config.draftSaveInterval || 15);

  // Keep branchRef in sync so image upload callback always has current value
  useEffect(() => { branchRef.current = branch; }, [branch]);

  // Ctrl+S / Cmd+S to save draft (ref assigned after handleSave is defined below)
  const handleSaveRef = useRef(null);

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
          // Update image approval from PR labels (handles recovery + live label changes)
          if (status.pr.labels?.includes('images-approved')) {
            setPrImagesApproved(true);
          }
          // Detect new activity since user last viewed/saved
          if (status.pr.updatedAt) {
            const lastSeen = localStorage.getItem(`poly_pr_seen_${branch}`);
            if (lastSeen) {
              const prUpdated = new Date(status.pr.updatedAt).getTime();
              const seenAt = Number(lastSeen);
              if (prUpdated > seenAt) {
                setHasNewActivity(true);
              }
            }
            // First time seeing this PR — record the timestamp (no indicator needed)
            if (!lastSeen) {
              localStorage.setItem(`poly_pr_seen_${branch}`, String(Date.now()));
            }
          }
        }
        if (status.behindMain) {
          setBehindMain(true);
        }
      }).catch(() => {});
    }
  }, [branch]);

  // Load author profile for blog posts
  useEffect(() => {
    if (type === 'blog') {
      getAuthorProfile().then(profile => {
        if (profile) setAuthorProfile(profile);
      }).catch(() => {});
    }
  }, [type]);

  // Save author profile to D1 (called alongside draft save)
  const saveAuthorProfileIfDirty = useCallback(async () => {
    if (!authorProfile || !authorProfileDirty) return;
    try {
      await saveAuthorProfile({
        display_name: authorProfile.display_name,
        title: authorProfile.title,
        url: authorProfile.url,
      });
      setAuthorProfileDirty(false);
    } catch (err) {
      console.error('Failed to save author profile:', err);
    }
  }, [authorProfile, authorProfileDirty]);

  const handleEditorChange = useCallback((markdown) => {
    setBody(markdown);
  }, []);

  // Image upload handler for MDXEditor's imagePlugin.
  // Uses branchRef instead of branch to avoid stale closure — the plugins
  // array is only built once but branchRef always has the current value.
  const handleImageUpload = useCallback(async (file) => {
    const currentBranch = branchRef.current;
    if (!currentBranch) {
      setStatusMessage('⚠️ Save your draft before uploading images.');
      throw new Error('Save your draft first');
    }
    try {
      setStatusMessage('Uploading image…');
      const result = await uploadImage(currentBranch, file);
      if (result.imageNumber) {
        setStatusMessage(
          `Image uploaded! In source view, you can also reference it as {{image:${result.imageNumber}}}`
        );
      }
      // Refresh the uploaded images list after a short delay — the GitHub
      // compare API may not reflect the new commit immediately.
      setImagesRefreshing(true);
      setTimeout(() => {
        listImages(currentBranch)
          .then(setUploadedImages)
          .catch(() => {})
          .finally(() => setImagesRefreshing(false));
      }, 2000);
      return result.previewUrl || result.path;
    } catch (err) {
      setStatusMessage(`⚠️ Image upload failed: ${err.message}`);
      throw err;
    }
  }, []);

  // Determine if user can upload images.
  // Sources: per-user KV approval, mod status, or per-PR "images-approved" label.
  const canUpload = user?.canUploadImages || user?.isMod || prImagesApproved;

  // Fetch uploaded images whenever branch or upload permission changes
  useEffect(() => {
    if (!branch || !canUpload) return;
    listImages(branch).then(setUploadedImages).catch(() => {});
  }, [branch, canUpload]);

  // Rewrite raw GitHub preview URLs back to relative site paths for storage.
  // Preview URLs: https://raw.githubusercontent.com/OWNER/REPO/BRANCH/static/img/user-uploads/...
  // Stored paths: /img/user-uploads/...
  const rewritePreviewUrls = (markdown) => {
    return markdown.replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/static(\/img\/user-uploads\/[^)\s"]+)/g,
      '$1'
    );
  };

  const handleSave = async () => {
    // Synchronous guard: prevents double-click race before React re-renders
    // and disables the button. Without this, two rapid clicks could both
    // enter handleSave before setSaving(true) takes effect.
    if (savingRef.current) return;
    savingRef.current = true;
    setErrors([]);
    setSaving(true);

    try {
      const result = await saveDraft({
        title,
        body: rewritePreviewUrls(body),
        type,
        category,
        subcategory: showNewSubcategory ? slugifyCategory(newSubcategory) : undefined,
        existingBranch: branch || undefined,
        editPath: !branch ? editPath : undefined,
        tags: type === 'blog' ? selectedTags : undefined,
        license: type === 'blog' ? license : undefined,
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
      if (result.noChange) {
        setStatusMessage('No changes to save.');
      } else {
        setThrottleCountdown(throttleSeconds);
        setStatusMessage(`Draft saved at ${new Date().toLocaleTimeString()}`);
        // Record seen timestamp — the user's own commit will bump PR updated_at,
        // so we update localStorage to prevent their own save from triggering
        // a false "new activity" indicator on next load.
        localStorage.setItem(`poly_pr_seen_${result.branch}`, String(Date.now()));
        setHasNewActivity(false);
      }

      if (onDraftSaved) onDraftSaved(result);

      // Save author profile alongside draft (non-blocking)
      if (type === 'blog') {
        saveAuthorProfileIfDirty();
      }
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  // Ctrl+S / Cmd+S to save draft
  handleSaveRef.current = handleSave;
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current?.();
      }
      if (e.key === 'Escape') {
        setShowPreview(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
      // Record seen timestamp for the newly created PR
      if (branch) {
        localStorage.setItem(`poly_pr_seen_${branch}`, String(Date.now()));
      }
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
      // Clean up activity tracking for this branch
      localStorage.removeItem(`poly_pr_seen_${branch}`);
      setBranch(null);
      setTitle('');
      setBody('');
      setPrInfo(null);
      setHasNewActivity(false);
      setStatusMessage('Draft abandoned.');
      if (onDraftAbandoned) onDraftAbandoned();
    } catch (err) {
      setErrors([err.message]);
    }
  };

  const handleMergeMain = async () => {
    if (!branch) return;
    setMerging(true);
    setErrors([]);

    try {
      const result = await mergeBranch(branch);

      if (result.merged) {
        setBehindMain(false);
        setPublishedVersion(null);
        setStatusMessage(result.noChange ? 'Already up to date.' : 'Branch updated from published version.');
      } else if (result.conflict) {
        setPublishedVersion(result.publishedContent);
        setStatusMessage('');
        setErrors([result.message || 'Merge conflict — review the published version and update your draft.']);
      }
    } catch (err) {
      setErrors([err.message]);
    } finally {
      setMerging(false);
    }
  };

  const handleDeleteImage = async (imgPath) => {
    try {
      // Find the image info before removing from state (need previewUrl for editor cleanup)
      const imgInfo = uploadedImages.find(img => img.path === imgPath);
      await deleteImage(branch, imgPath);
      setUploadedImages(prev => prev.filter(img => img.path !== imgPath));
      setDeletingImage(null);
      setStatusMessage('Image deleted.');

      // Remove the image from the editor content
      if (editorRef.current) {
        const currentMarkdown = editorRef.current.getMarkdown();
        // Remove markdown image references matching either the previewUrl or the site path
        const cleaned = currentMarkdown
          .replace(new RegExp(`!\\[[^\\]]*\\]\\(${imgInfo?.previewUrl?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n?`, 'g'), '')
          .replace(new RegExp(`!\\[[^\\]]*\\]\\(${imgPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\n?`, 'g'), '');
        if (cleaned !== currentMarkdown) {
          editorRef.current.setMarkdown(cleaned);
          setBody(cleaned);
        }
      }
    } catch (err) {
      setStatusMessage(`⚠️ Failed to delete image: ${err.message}`);
      setDeletingImage(null);
    }
  };

  const saveDisabled = saving || throttleCountdown > 0 || !title.trim() || !body.trim();
  const hasOpenPR = prInfo && prInfo.state === 'open';
  const submitDisabled = submitting || !branch || hasOpenPR;

  return (
    <div className="editor-container">
      {/* Content type selector (only for new drafts, not when editing existing page) */}
      {!branch && !editPath && (
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
            New Story
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
          disabled={!!branch}
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
      {(branch || editPath) && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.5rem 0.75rem',
          fontSize: '0.85rem',
          color: 'var(--ifm-color-emphasis-600)',
          backgroundColor: 'var(--ifm-color-emphasis-100)',
          borderRadius: '4px',
          fontFamily: 'var(--ifm-font-family-monospace)',
        }}>
          {editPath && !branch
            ? `Editing: ${editPath}`
            : (
              <>
                {type === 'blog' ? 'Story' : `Wiki → ${formatCategoryLabel(category)}`}
                {' · '}
                <span style={{ color: 'var(--ifm-color-emphasis-500)' }}>
                  {branch.split('/').pop()}
                </span>
              </>
            )
          }
        </div>
      )}

      {/* Category selector (wiki only, new drafts only, not when editing existing page) */}
      {type === 'wiki' && !branch && !editPath && (
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

      {/* Image guidance / copyright notice */}
      {canUpload ? (<>
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '0.5rem',
          fontSize: '0.8rem',
          color: 'var(--ifm-color-emphasis-600)',
          backgroundColor: 'var(--ifm-color-emphasis-100)',
          borderRadius: '4px',
        }}>
          <strong>Image guidelines:</strong> Only upload images you created or have permission to use.
          Do not upload images from other websites or search engines.
          <br />You can drag and drop images into the editor, paste from clipboard, or use the toolbar button.
          See <a href="/terms-of-contribution" target="_blank" rel="noopener noreferrer">Terms of Contribution</a> for details.
          {!branch && <> <strong>Save your draft before uploading images.</strong></>}
          {branch && <><br /><strong>Tip:</strong> In source view, use{' '}
          <code style={{ fontSize: '0.75rem' }}>{'{{image:1 | caption}}'}</code>{' '}
          to place uploaded images (number shown after each upload).</>}
        </div>
        {(uploadedImages.length > 0 || imagesRefreshing) && (
          <div style={{
            padding: '0.5rem 0.75rem',
            marginBottom: '0.5rem',
            fontSize: '0.8rem',
            backgroundColor: 'var(--ifm-color-emphasis-100)',
            borderRadius: '4px',
          }}>
            <strong>Uploaded images ({uploadedImages.length}):</strong>
            {imagesRefreshing && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: 'var(--ifm-color-emphasis-500)' }}>Refreshing…</span>}
            {!imagesRefreshing && uploadedImages.length > 0 && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--ifm-color-emphasis-500)' }}>Click to insert into editor</span>}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {uploadedImages.map(img => (
                <div key={img.path} style={{ position: 'relative', textAlign: 'center' }}>
                  <img
                    src={img.previewUrl}
                    alt={img.filename}
                    title="Click to insert into editor"
                    onClick={() => {
                      editorRef.current?.insertMarkdown?.(`![${img.filename}](${img.previewUrl})`);
                      editorRef.current?.focus?.();
                    }}
                    style={{
                      width: '80px',
                      height: '80px',
                      objectFit: 'cover',
                      borderRadius: '4px',
                      border: '1px solid var(--ifm-color-emphasis-300)',
                      cursor: 'pointer',
                    }}
                  />
                  {deletingImage === img.path ? (
                    <div style={{ fontSize: '0.7rem', marginTop: '0.25rem' }}>
                      <span>Delete?</span>{' '}
                      <button
                        onClick={() => handleDeleteImage(img.path)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--ifm-color-danger)',
                          cursor: 'pointer',
                          padding: '0 0.25rem',
                          fontSize: '0.7rem',
                          fontWeight: 'bold',
                        }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setDeletingImage(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--ifm-color-emphasis-600)',
                          cursor: 'pointer',
                          padding: '0 0.25rem',
                          fontSize: '0.7rem',
                        }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeletingImage(img.path)}
                      title="Delete image"
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        background: 'var(--ifm-color-danger)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        fontSize: '12px',
                        lineHeight: '20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  )}
                  <div style={{
                    fontSize: '0.65rem',
                    color: 'var(--ifm-color-emphasis-500)',
                    maxWidth: '80px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    marginTop: '0.15rem',
                  }}>
                    {img.filename}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </>) : (
        <div style={{
          padding: '0.5rem 0.75rem',
          marginBottom: '0.5rem',
          fontSize: '0.8rem',
          color: 'var(--ifm-color-emphasis-600)',
          backgroundColor: 'var(--ifm-color-emphasis-100)',
          borderRadius: '4px',
        }}>
          Image uploads require mod approval. Use placeholders to describe images you&apos;d like to include:{' '}
          <code style={{ fontSize: '0.75rem' }}>{'<!-- image: description of your image -->'}</code>
        </div>
      )}

      {/* Status message — above editor for visibility */}
      {statusMessage && (() => {
        const isWarning = statusMessage.startsWith('⚠️');
        const isUploading = statusMessage === 'Uploading image…';
        return (
          <div style={{
            padding: '0.6rem 0.75rem',
            marginBottom: '0.5rem',
            borderRadius: '4px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: isWarning
              ? 'var(--ifm-color-warning-darkest)'
              : 'var(--ifm-color-success-darkest)',
            backgroundColor: isWarning
              ? 'var(--ifm-color-warning-contrast-background)'
              : 'var(--ifm-color-success-contrast-background)',
            border: `1px solid ${isWarning
              ? 'var(--ifm-color-warning-dark)'
              : 'var(--ifm-color-success-dark)'}`,
          }}>
            {isUploading && (
              <span className="editor-spinner" style={{
                width: '14px',
                height: '14px',
                border: '2px solid var(--ifm-color-emphasis-300)',
                borderTopColor: 'var(--ifm-color-primary)',
                borderRadius: '50%',
                display: 'inline-block',
                flexShrink: 0,
              }} />
            )}
            {statusMessage}
          </div>
        );
      })()}

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
            imagePlugin({
              imageUploadHandler: canUpload ? handleImageUpload : undefined,
              disableImageResize: true,
            }),
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
                  {canUpload && branch && <InsertImage />}
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


      {/* PR Status */}
      {prInfo && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: hasNewActivity
            ? 'var(--ifm-color-success-contrast-background)'
            : 'var(--ifm-color-info-contrast-background)',
          border: `1px solid ${hasNewActivity ? 'var(--ifm-color-success-dark)' : 'var(--ifm-color-info-dark)'}`,
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
          {hasNewActivity && (
            <div style={{
              marginTop: '0.5rem',
              padding: '0.4rem 0.6rem',
              backgroundColor: 'var(--ifm-color-success-contrast-background)',
              border: '1px solid var(--ifm-color-success)',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.9rem',
            }}>
              <span>
                <strong style={{ color: 'var(--ifm-color-success-darkest)' }}>New activity</strong>
                {' — '}a moderator may have left feedback on your submission.
                {prInfo.url && (
                  <>
                    {' '}
                    <a href={prInfo.url} target="_blank" rel="noopener noreferrer">
                      View on GitHub
                    </a>
                  </>
                )}
              </span>
              <button
                className="button button--sm button--outline button--secondary"
                onClick={() => {
                  setHasNewActivity(false);
                  if (branch) {
                    localStorage.setItem(`poly_pr_seen_${branch}`, String(Date.now()));
                  }
                }}
                style={{ marginLeft: '0.5rem', whiteSpace: 'nowrap' }}
              >
                Dismiss
              </button>
            </div>
          )}
          {prInfo.changesRequested && (
            <div style={{ marginTop: '0.25rem', color: 'var(--ifm-color-warning-darkest)' }}>
              Changes have been requested. Edit your draft and save to update the PR.
            </div>
          )}
          {!hasNewActivity && prInfo.url && (
            <div style={{ marginTop: '0.25rem' }}>
              <a href={prInfo.url} target="_blank" rel="noopener noreferrer">
                View PR on GitHub
              </a>
            </div>
          )}
        </div>
      )}

      {/* Branch behind main warning */}
      {behindMain && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: 'var(--ifm-color-warning-contrast-background)',
          border: '1px solid var(--ifm-color-warning-dark)',
          borderRadius: '4px',
          color: 'var(--ifm-color-warning-darkest)',
        }}>
          <strong>Note:</strong> The site has been updated since you started this draft. Update your branch to get the latest content and features.{' '}
          <button
            className="button button--sm button--warning"
            onClick={handleMergeMain}
            disabled={merging}
            style={{ marginLeft: '0.5rem' }}
          >
            {merging ? 'Updating...' : 'Update now'}
          </button>
        </div>
      )}

      {/* Published version panel (shown on merge conflict) */}
      {publishedVersion && (
        <div style={{
          marginBottom: '1rem',
          border: '1px solid var(--ifm-color-danger-dark)',
          borderRadius: '4px',
        }}>
          <div style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: 'var(--ifm-color-danger-contrast-background)',
            borderBottom: '1px solid var(--ifm-color-danger-dark)',
            fontWeight: 600,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <span>Published Version (read-only)</span>
            <button
              className="button button--sm button--outline button--secondary"
              onClick={() => setPublishedVersion(null)}
            >
              Dismiss
            </button>
          </div>
          <div style={{
            padding: '0.75rem',
            maxHeight: '300px',
            overflow: 'auto',
            fontSize: '0.9rem',
            fontFamily: 'var(--ifm-font-family-monospace)',
            whiteSpace: 'pre-wrap',
            backgroundColor: 'var(--ifm-color-emphasis-100)',
          }}>
            <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>
              Title: {publishedVersion.title}
            </div>
            {publishedVersion.body}
          </div>
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
            ? (hasOpenPR ? 'Updating...' : 'Saving...')
            : throttleCountdown > 0
              ? `${hasOpenPR ? 'Update' : 'Save Draft'} (${formatCountdown(throttleCountdown)})`
              : (hasOpenPR ? 'Update Submission' : 'Save Draft')
          }
        </button>

        {/* Only show Submit button when no PR exists yet */}
        {!hasOpenPR && (
          <button
            className="button button--success"
            onClick={() => setShowSubmitConfirm(true)}
            disabled={submitDisabled}
          >
            {submitting ? 'Submitting...' : 'Submit for Review'}
          </button>
        )}

        <button
          className="button button--outline button--secondary"
          onClick={() => {
            const md = editorRef.current?.getMarkdown?.() || body;
            setPreviewHtml(marked.parse(rewritePreviewUrls(md)));
            setShowPreview(true);
          }}
        >
          Preview
        </button>

        {branch && (
          <button
            className="button button--outline button--danger"
            onClick={() => setShowAbandonConfirm(true)}
          >
            {hasOpenPR ? 'Withdraw' : 'Abandon'}
          </button>
        )}
      </div>

      {/* Preview modal */}
      {showPreview && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: '2rem',
            overflow: 'auto',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}
        >
          <div style={{
            backgroundColor: 'var(--ifm-background-color)',
            borderRadius: '8px',
            width: '100%',
            maxWidth: '800px',
            maxHeight: '90vh',
            overflow: 'auto',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.3)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.75rem 1.25rem',
              borderBottom: '1px solid var(--ifm-color-emphasis-200)',
              position: 'sticky',
              top: 0,
              backgroundColor: 'var(--ifm-background-color)',
              zIndex: 1,
            }}>
              <strong style={{ fontSize: '1.1rem' }}>Preview: {title || 'Untitled'}</strong>
              <button
                onClick={() => setShowPreview(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  color: 'var(--ifm-color-emphasis-600)',
                  padding: '0 0.25rem',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div
              className="markdown"
              style={{ padding: '1.5rem 1.25rem' }}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>
        </div>
      )}

      {/* Tags (stories only, new drafts only) */}
      {type === 'blog' && !branch && !editPath && (
        <details className="editor-collapsible-section" style={{ marginTop: '1rem' }}>
          <summary className="editor-collapsible-section__summary">
            Tags — help readers find your story
            {selectedTags.length > 0 && (
              <span className="editor-collapsible-section__badge">
                {selectedTags.length} selected
              </span>
            )}
          </summary>
          <div style={{ paddingTop: '0.75rem' }}>
            <TagSelector
              selectedTags={selectedTags}
              onChange={setSelectedTags}
              isMod={user?.isMod}
            />
          </div>
        </details>
      )}

      {/* Author profile (stories only) */}
      {type === 'blog' && authorProfile && (
        <details className="editor-collapsible-section" style={{ marginTop: '0.75rem' }}>
          <summary className="editor-collapsible-section__summary">
            Author Profile
            {authorProfile.display_name && authorProfile.display_name !== user?.username && (
              <span className="editor-collapsible-section__badge">
                {authorProfile.display_name}
              </span>
            )}
          </summary>
          <div style={{ paddingTop: '0.75rem' }}>
            <AuthorProfileEditor
              profile={authorProfile}
              isMod={user?.isMod}
              onChange={(updated) => {
                setAuthorProfile(updated);
                setAuthorProfileDirty(true);
              }}
            />
          </div>
        </details>
      )}

      {/* License selector (stories only, new drafts only) */}
      {type === 'blog' && !branch && !editPath && (
        <div className="license-selector" style={{ marginTop: '0.75rem' }}>
          <div className="license-selector__header">
            <span className="license-selector__label">License for your story</span>
            <button
              type="button"
              className="license-selector__help-btn"
              onClick={() => setShowLicenseHelp(!showLicenseHelp)}
              aria-label="Learn about license options"
            >
              ?
            </button>
          </div>
          <div className="license-selector__options">
            <label className={`license-option${license === 'cc-by-nc-sa' ? ' license-option--selected' : ''}`}>
              <input
                type="radio"
                name="license"
                value="cc-by-nc-sa"
                checked={license === 'cc-by-nc-sa'}
                onChange={() => setLicense('cc-by-nc-sa')}
              />
              <div className="license-option__content">
                <span className="license-option__name">CC BY-NC-SA 4.0</span>
                <span className="license-option__short">Others can share &amp; adapt (non-commercial)</span>
              </div>
            </label>
            <label className={`license-option${license === 'all-rights-reserved' ? ' license-option--selected' : ''}`}>
              <input
                type="radio"
                name="license"
                value="all-rights-reserved"
                checked={license === 'all-rights-reserved'}
                onChange={() => setLicense('all-rights-reserved')}
              />
              <div className="license-option__content">
                <span className="license-option__name">All Rights Reserved</span>
                <span className="license-option__short">Read-only on this site</span>
              </div>
            </label>
          </div>
          {showLicenseHelp && (
            <div className="license-help">
              <div className="license-help__card">
                <h4>🌐 CC BY-NC-SA 4.0 <span className="license-help__default">default</span></h4>
                <p>Others can share and adapt your writing, as long as they credit you, keep it non-commercial, and use the same license. You can still do whatever you want with your own work — these rules only apply to everyone else.</p>
                <p><strong>Choose this if</strong> you want your story to spread and help as many people as possible. Most community contributions use this.</p>
              </div>
              <div className="license-help__card">
                <h4>🔒 All Rights Reserved</h4>
                <p>Others can read your piece here, link to it, and quote short excerpts — but they can't repost or redistribute it. Think of it like renting out a room: you set the rules for guests, but they don't apply to you. You can still publish elsewhere, sell it, or license it however you like.</p>
                <p><strong>Choose this if</strong> you're a professional writer, plan to publish this elsewhere, or just want tighter control over your work.</p>
              </div>
              <p className="license-help__footer">
                Either way, you keep full ownership of your work.{' '}
                <a href="/terms-of-contribution" target="_blank" rel="noopener noreferrer">
                  Learn more →
                </a>
              </p>
            </div>
          )}
        </div>
      )}

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

function AuthorProfileEditor({ profile, isMod, onChange }) {
  const handleChange = (field, value) => {
    onChange({ ...profile, [field]: value });
  };

  return (
    <div className="author-profile-editor">
      <div className="author-profile-field">
        <label className="author-profile-field__label">Display Name</label>
        <input
          type="text"
          value={profile.display_name || ''}
          onChange={e => handleChange('display_name', e.target.value)}
          placeholder="Your display name"
          maxLength={100}
          className="author-profile-field__input"
        />
      </div>
      <div className="author-profile-field">
        <label className="author-profile-field__label">Title</label>
        {isMod ? (
          <input
            type="text"
            value={profile.title || ''}
            onChange={e => handleChange('title', e.target.value)}
            placeholder="e.g., Site Author"
            maxLength={100}
            className="author-profile-field__input"
          />
        ) : (
          <div className="author-profile-field__static">
            Community Contributor
          </div>
        )}
      </div>
      <div className="author-profile-field">
        <label className="author-profile-field__label">URL (optional)</label>
        <input
          type="url"
          value={profile.url || ''}
          onChange={e => handleChange('url', e.target.value)}
          placeholder="https://your-website-or-profile.com"
          maxLength={500}
          className="author-profile-field__input"
        />
      </div>
      <div className="author-profile-field__hint">
        Your avatar is automatically pulled from your GitHub profile.
      </div>
    </div>
  );
}

const EDITOR_TAG_CATEGORIES = [
  {
    label: 'Topic',
    required: true,
    tags: [
      'jealousy', 'communication', 'boundaries', 'dating', 'family', 'growth',
      'breakup', 'coming-out', 'happy-memories', 'favorite-moments',
      'lessons-learned', 'overcoming-challenges',
    ],
  },
  {
    label: 'Structure',
    required: false,
    tags: ['solo-poly', 'couple', 'vee', 'triad', 'quad', 'polycule'],
  },
  {
    label: 'Style',
    required: false,
    tags: ['open', 'closed', 'hierarchical', 'non-hierarchical', 'swinging', 'married'],
  },
  {
    label: 'Editorial',
    required: false,
    tags: ['community', 'education', 'debunking', 'research'],
  },
];

function formatTagLabel(tag) {
  return tag
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function TagSelector({ selectedTags, onChange, isMod }) {
  const toggle = (tag) => {
    if (selectedTags.includes(tag)) {
      onChange(selectedTags.filter(t => t !== tag));
    } else {
      onChange([...selectedTags, tag]);
    }
  };

  const categories = isMod
    ? [...EDITOR_TAG_CATEGORIES, { label: 'Mod', required: false, tags: ['announcements'] }]
    : EDITOR_TAG_CATEGORIES;

  const hasTopicTag = selectedTags.some(t =>
    EDITOR_TAG_CATEGORIES[0].tags.includes(t),
  );

  return (
    <div className="editor-tag-selector">
      {categories.map(cat => (
        <div key={cat.label} className="editor-tag-group">
          <span className="editor-tag-group__label">
            {cat.label}
            {cat.required && ' *'}
          </span>
          <div className="editor-tag-options">
            {cat.tags.map(tag => (
              <button
                key={tag}
                type="button"
                className={`editor-tag-option${selectedTags.includes(tag) ? ' editor-tag-option--selected' : ''}`}
                onClick={() => toggle(tag)}
              >
                {formatTagLabel(tag)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {!hasTopicTag && selectedTags.length > 0 && (
        <div className="editor-tag-error">
          Please select at least one Topic tag.
        </div>
      )}
    </div>
  );
}
