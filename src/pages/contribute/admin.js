/**
 * /contribute/admin — Moderator admin panel.
 *
 * Features:
 * - View all contributors, their branches, trust tiers, and activity
 * - Toggle image upload approval for users
 * - Update system configuration (submissions enabled, rate limits)
 * - Force-delete user branches (with PR auto-close)
 *
 * Access: Restricted to moderators (GitHub collaborators with write/admin).
 */

import React, { useState, useEffect, useCallback } from 'react';
import Layout from '@theme/Layout';
import BrowserOnly from '@docusaurus/BrowserOnly';
import Heading from '@theme/Heading';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

function AdminPage() {
  const { siteConfig } = useDocusaurusContext();

  if (typeof window !== 'undefined' && siteConfig.customFields?.apiUrl) {
    window.__POLY_API_URL = window.__POLY_API_URL || siteConfig.customFields.apiUrl;
  }

  return (
    <Layout title="Admin Panel" description="Moderator administration panel">
      <main style={{ padding: '2rem 0' }}>
        <div className="container">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
            <a href="/contribute" style={{ fontSize: '0.9rem' }}>&larr; Back to Contribute</a>
            <Heading as="h1" style={{ margin: 0 }}>Admin Panel</Heading>
          </div>
          <BrowserOnly fallback={<div>Loading...</div>}>
            {() => <AdminApp />}
          </BrowserOnly>
        </div>
      </main>
    </Layout>
  );
}

function AdminApp() {
  const [user, setUser] = useState(undefined);
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionMessage, setActionMessage] = useState(null);

  const apiRef = React.useRef(null);

  function getApiUrl() {
    if (typeof window !== 'undefined' && window.__POLY_API_URL) {
      return window.__POLY_API_URL;
    }
    return 'https://api.polyconvergence.com';
  }

  async function adminFetch(path, options = {}) {
    const url = `${getApiUrl()}${path}`;
    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    return res;
  }

  const loadData = useCallback(async () => {
    try {
      const api = await import('../../components/Contribute/api');
      apiRef.current = api;

      const userData = await api.getUser();
      setUser(userData);

      if (!userData || !userData.isMod) {
        setError('Access denied. This page is for moderators only.');
        setLoading(false);
        return;
      }

      const [usersRes, configData] = await Promise.all([
        adminFetch('/api/admin/users'),
        api.getConfig(),
      ]);

      if (!usersRes.ok) {
        throw new Error('Failed to load users');
      }

      const usersData = await usersRes.json();
      setUsers(usersData.users || []);
      setConfig(configData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const showAction = (msg, isError = false) => {
    setActionMessage({ text: msg, isError });
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleApproveImages = async (githubId, username, approved) => {
    try {
      const res = await adminFetch('/api/admin/approve-images', {
        method: 'POST',
        body: JSON.stringify({ githubId, approved }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update');
      }
      showAction(`${approved ? 'Approved' : 'Revoked'} image uploads for ${username}`);
      setUsers(prev => prev.map(u =>
        u.kvKey === `user:${githubId}` ? { ...u, imageApproved: approved } : u
      ));
    } catch (err) {
      showAction(err.message, true);
    }
  };

  const handleDeleteBranch = async (branch) => {
    if (!window.confirm(`Delete branch "${branch}"? This will also close any associated PR.`)) {
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/branch?branch=${encodeURIComponent(branch)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete');
      }
      const data = await res.json();
      showAction(`Deleted ${branch}${data.prClosed ? ` (closed PR #${data.prClosed})` : ''}`);
      // Remove the branch from local state
      setUsers(prev => prev.map(u => ({
        ...u,
        activeBranches: u.activeBranches.filter(b => b.branch !== branch),
      })));
    } catch (err) {
      showAction(err.message, true);
    }
  };

  const handleConfigUpdate = async (key, value) => {
    try {
      const res = await adminFetch('/api/admin/config', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update config');
      }
      showAction(`Updated ${key} = ${value}`);
      // Refresh config
      if (apiRef.current) {
        const newConfig = await apiRef.current.getConfig();
        setConfig(newConfig);
      }
    } catch (err) {
      showAction(err.message, true);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading admin panel...</div>;
  }

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

  return (
    <div>
      {actionMessage && (
        <div style={{
          padding: '0.75rem',
          marginBottom: '1rem',
          backgroundColor: actionMessage.isError
            ? 'var(--ifm-color-danger-contrast-background)'
            : 'var(--ifm-color-success-contrast-background)',
          border: `1px solid ${actionMessage.isError
            ? 'var(--ifm-color-danger-dark)'
            : 'var(--ifm-color-success-dark)'}`,
          borderRadius: '4px',
        }}>
          {actionMessage.text}
        </div>
      )}

      {/* System Config */}
      <ConfigSection config={config} onUpdate={handleConfigUpdate} />

      {/* Users */}
      <Heading as="h2" style={{ marginTop: '2rem' }}>
        Contributors ({users.length})
      </Heading>
      {users.length === 0 ? (
        <p style={{ color: 'var(--ifm-color-emphasis-600)' }}>No registered contributors yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {users.map(u => (
            <UserCard
              key={u.kvKey}
              user={u}
              onApproveImages={handleApproveImages}
              onDeleteBranch={handleDeleteBranch}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ConfigSection({ config, onUpdate }) {
  if (!config) return null;

  return (
    <div>
      <Heading as="h2">System Configuration</Heading>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '0.75rem',
      }}>
        <ConfigToggle
          label="Submissions Enabled"
          value={config.submissionsEnabled}
          configKey="submissions_enabled"
          onUpdate={onUpdate}
        />
        <ConfigNumber
          label="Draft Save Interval (seconds)"
          value={config.draftSaveInterval}
          configKey="draft_save_interval"
          min={10}
          max={600}
          onUpdate={onUpdate}
        />
        <ConfigNumber
          label="Max Image Size (KB)"
          value={config.maxImageSizeKB}
          configKey="max_image_size_kb"
          min={100}
          max={10240}
          onUpdate={onUpdate}
        />
        <ConfigNumber
          label="Max Images Per Submission"
          value={config.maxImagesPerSubmission}
          configKey="max_images_per_submission"
          min={0}
          max={20}
          onUpdate={onUpdate}
        />
      </div>
    </div>
  );
}

function ConfigToggle({ label, value, configKey, onUpdate }) {
  return (
    <div style={{
      padding: '0.75rem',
      border: '1px solid var(--ifm-color-emphasis-300)',
      borderRadius: '6px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{label}</span>
      <button
        className={`button button--sm ${value ? 'button--success' : 'button--danger'}`}
        onClick={() => onUpdate(configKey, !value)}
        style={{ minWidth: '60px' }}
      >
        {value ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

function ConfigNumber({ label, value, configKey, min, max, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value));

  const handleSave = () => {
    const num = parseInt(inputVal, 10);
    if (isNaN(num) || num < min || num > max) {
      alert(`Value must be between ${min} and ${max}`);
      return;
    }
    onUpdate(configKey, num);
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{
        padding: '0.75rem',
        border: '1px solid var(--ifm-color-primary)',
        borderRadius: '6px',
      }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem' }}>{label}</div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="number"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            min={min}
            max={max}
            style={{
              width: '80px',
              padding: '0.25rem 0.5rem',
              border: '1px solid var(--ifm-color-emphasis-300)',
              borderRadius: '4px',
            }}
          />
          <button className="button button--sm button--primary" onClick={handleSave}>Save</button>
          <button className="button button--sm button--outline button--secondary" onClick={() => { setEditing(false); setInputVal(String(value)); }}>Cancel</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--ifm-color-emphasis-500)' }}>{min}–{max}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '0.75rem',
      border: '1px solid var(--ifm-color-emphasis-300)',
      borderRadius: '6px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      cursor: 'pointer',
    }} onClick={() => setEditing(true)}>
      <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{label}</span>
      <span style={{
        fontSize: '0.9rem',
        fontFamily: 'var(--ifm-font-family-monospace)',
        color: 'var(--ifm-color-primary)',
      }}>
        {value}
      </span>
    </div>
  );
}

function UserCard({ user, onApproveImages, onDeleteBranch }) {
  const [expanded, setExpanded] = useState(false);
  const githubId = user.kvKey.replace('user:', '');

  return (
    <div style={{
      border: '1px solid var(--ifm-color-emphasis-300)',
      borderRadius: '6px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div
        style={{
          padding: '0.75rem 1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          backgroundColor: 'var(--ifm-color-emphasis-100)',
        }}
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <strong>{user.username}</strong>
          <span style={{
            fontSize: '0.75rem',
            padding: '0.1rem 0.4rem',
            borderRadius: '3px',
            backgroundColor: user.mergedCount > 0 ? 'var(--ifm-color-success-contrast-background)' : 'var(--ifm-color-emphasis-200)',
            color: user.mergedCount > 0 ? 'var(--ifm-color-success-darkest)' : 'var(--ifm-color-emphasis-700)',
          }}>
            {user.mergedCount} merged
          </span>
          {user.imageApproved && (
            <span style={{
              fontSize: '0.75rem',
              padding: '0.1rem 0.4rem',
              borderRadius: '3px',
              backgroundColor: 'var(--ifm-color-info-contrast-background)',
              color: 'var(--ifm-color-info-darkest)',
            }}>
              images approved
            </span>
          )}
          <span style={{ fontSize: '0.8rem', color: 'var(--ifm-color-emphasis-500)' }}>
            {user.activeBranches.length} branch{user.activeBranches.length !== 1 ? 'es' : ''}
          </span>
        </div>
        <span style={{ fontSize: '0.85rem' }}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {/* Details */}
      {expanded && (
        <div style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button
              className={`button button--sm ${user.imageApproved ? 'button--outline button--danger' : 'button--success'}`}
              onClick={() => onApproveImages(githubId, user.username, !user.imageApproved)}
            >
              {user.imageApproved ? 'Revoke Image Approval' : 'Approve Images'}
            </button>
          </div>

          <div style={{ fontSize: '0.85rem', color: 'var(--ifm-color-emphasis-600)', marginBottom: '0.5rem' }}>
            Joined: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Unknown'}
          </div>

          {user.activeBranches.length > 0 && (
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Active Branches:</div>
              {user.activeBranches.map(b => (
                <div key={b.branch} style={{
                  padding: '0.5rem',
                  marginBottom: '0.5rem',
                  backgroundColor: 'var(--ifm-color-emphasis-100)',
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.85rem',
                }}>
                  <div>
                    <code style={{ fontSize: '0.8rem' }}>{b.branch}</code>
                    <div style={{ marginTop: '0.25rem', color: 'var(--ifm-color-emphasis-500)' }}>
                      {b.hasPR ? (
                        <a href={b.prUrl} target="_blank" rel="noopener noreferrer">
                          PR #{b.prNumber}
                        </a>
                      ) : (
                        'No PR'
                      )}
                      {b.lastActivity && (
                        <span style={{ marginLeft: '0.75rem' }}>
                          Last activity: {new Date(b.lastActivity).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="button button--sm button--outline button--danger"
                    onClick={() => onDeleteBranch(b.branch)}
                    title="Delete branch and close PR"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminPage;
