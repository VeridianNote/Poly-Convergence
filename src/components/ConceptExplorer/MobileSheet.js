import { useState } from 'react';
import Link from '@docusaurus/Link';
import styles from './MobileSheet.module.css';

const CATEGORY_COLORS = {
  'relationship-structures': '#0d9488',
  'relationship-styles': '#7c3aed',
  'core-concepts': '#6366f1',
  'healthy-patterns': '#16a34a',
  'unhealthy-patterns': '#dc2626',
  'evaluation-tools': '#d97706',
  'research': '#64748b',
  'community-context': '#92400e',
};

const EDGE_TYPE_LABELS = {
  'is-type-of': 'Type of',
  'often-confused-with': 'Often confused with',
  'contrast': 'Contrast',
  'can-lead-to': 'Can lead to',
  'is-part-of': 'Part of',
  'related': 'Related',
};

function categoryLabel(category) {
  return category
    ? category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';
}

function getNeighbors(node, edges, allNodes) {
  if (!node) return {};
  const grouped = {};

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    const isSource = sourceId === node.id;
    const isTarget = targetId === node.id;
    if (!isSource && !isTarget) continue;

    const neighborId = isSource ? targetId : sourceId;
    const neighbor = allNodes.find((n) => n.id === neighborId);
    if (!neighbor) continue;

    const type = edge.type || 'related';
    if (!grouped[type]) grouped[type] = [];
    grouped[type].push(neighbor);
  }

  return grouped;
}

export default function MobileSheet({ node, edges, allNodes, onNodeClick, onBack, canGoBack }) {
  const [expanded, setExpanded] = useState(false);

  const grouped = node ? getNeighbors(node, edges, allNodes) : {};
  const categoryColor = node ? (CATEGORY_COLORS[node.category] || '#6366f1') : null;

  function handleToggle() {
    setExpanded((prev) => !prev);
  }

  function handleNodeClick(id) {
    onNodeClick(id);
    // Collapse after navigating to a new node so user sees it fresh
    setExpanded(false);
  }

  return (
    <div className={`${styles.sheet} ${expanded ? styles.expanded : ''}`}>
      {/* Handle / collapsed header */}
      <div className={styles.handle} onClick={handleToggle} role="button" aria-expanded={expanded} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && handleToggle()}>
        <div className={styles.handleBar} aria-hidden="true" />
        <div className={styles.collapsedRow}>
          {node ? (
            <>
              <span className={styles.collapsedLabel}>{node.label}</span>
              {node.category && (
                <span
                  className={styles.categoryBadge}
                  style={{ backgroundColor: categoryColor }}
                >
                  {categoryLabel(node.category)}
                </span>
              )}
            </>
          ) : (
            <span className={styles.collapsedPlaceholder}>Tap a concept to explore</span>
          )}
          <span className={styles.chevron} aria-hidden="true">
            {expanded ? '▼' : '▲'}
          </span>
        </div>
      </div>

      {/* Expanded content */}
      <div className={styles.body}>
        {node ? (
          <>
            {canGoBack && (
              <button
                className={styles.backBtn}
                onClick={() => { onBack(); setExpanded(false); }}
              >
                ← Back
              </button>
            )}

            {node.definition && (
              <p className={styles.definition}>{node.definition}</p>
            )}

            {node.hasPage && node.url && (
              <div className={styles.articleLink}>
                {node.pageType === 'external' ? (
                  <a
                    href={node.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.readLink}
                  >
                    Read article <span aria-hidden="true">↗</span>
                  </a>
                ) : (
                  <Link to={node.url} className={styles.readLink}>
                    Read article →
                  </Link>
                )}
              </div>
            )}

            {Object.keys(grouped).length > 0 && (
              <div className={styles.connections}>
                <h3 className={styles.connectionsHeading}>Connections</h3>
                {Object.entries(grouped).map(([type, neighbors]) => (
                  <div key={type} className={styles.connectionGroup}>
                    <span className={styles.edgeTypeLabel}>
                      {EDGE_TYPE_LABELS[type] || type}
                    </span>
                    <ul className={styles.neighborList}>
                      {neighbors.map((neighbor) => (
                        <li key={neighbor.id}>
                          <button
                            className={styles.neighborBtn}
                            onClick={() => handleNodeClick(neighbor.id)}
                          >
                            <span className={styles.pageIndicator} aria-hidden="true">
                              {neighbor.hasPage ? '●' : '○'}
                            </span>
                            {neighbor.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className={styles.emptyBody}>
            Select a node in the graph to see its definition, related concepts, and links to full articles.
          </p>
        )}
      </div>
    </div>
  );
}
