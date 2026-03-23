import Link from '@docusaurus/Link';
import styles from './InfoPanel.module.css';

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

export default function InfoPanel({ node, edges, allNodes, onNodeClick, onBack, canGoBack, onNodeHover }) {
  if (!node) {
    return (
      <aside className={styles.panel}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>✦</div>
          <p className={styles.emptyHeading}>Click any concept to explore</p>
          <p className={styles.emptyBody}>
            Select a node in the graph to see its definition, related concepts, and links to full articles.
          </p>
        </div>
      </aside>
    );
  }

  const grouped = getNeighbors(node, edges, allNodes);
  const categoryColor = CATEGORY_COLORS[node.category] || '#6366f1';

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>
        {canGoBack && (
          <button className={styles.backBtn} onClick={onBack} aria-label="Go back">
            ← Back
          </button>
        )}
        <h2 className={styles.nodeLabel}>{node.label}</h2>
        {node.category && (
          <span
            className={styles.categoryBadge}
            style={{ backgroundColor: categoryColor }}
          >
            {categoryLabel(node.category)}
          </span>
        )}
      </div>

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
              Read article <span className={styles.externalIcon} aria-hidden="true">↗</span>
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
                      onClick={() => onNodeClick(neighbor.id)}
                      onMouseEnter={() => onNodeHover && onNodeHover(neighbor.id)}
                      onMouseLeave={() => onNodeHover && onNodeHover(null)}
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
    </aside>
  );
}
