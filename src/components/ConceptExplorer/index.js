import { useState, useEffect, useMemo, useCallback } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useIsBrowser from '@docusaurus/useIsBrowser';
import Graph from './Graph';
import InfoPanel from './InfoPanel';
import MobileSheet from './MobileSheet';
import FilterChips from './FilterChips';
import graphData from '../../data/concept-graph.json';
import styles from './Explorer.module.css';

const DEFAULT_FOCUS = 'poly-convergence';

function getHashNodeId() {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.slice(1);
  return hash || null;
}

function ExplorerInner() {
  const [focusedNodeId, setFocusedNodeId] = useState(() => getHashNodeId() || DEFAULT_FOCUS);
  const [activeEdgeTypes, setActiveEdgeTypes] = useState(new Set());
  const [focusHistory, setFocusHistory] = useState([]);
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);

  // Deep clone so D3 can mutate positions without affecting the original import
  const { nodes, edges } = useMemo(() => ({
    nodes: graphData.nodes.map(n => ({ ...n })),
    edges: graphData.edges.map(e => ({ ...e })),
  }), []);

  // Responsive check
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Sync URL hash
  useEffect(() => {
    if (focusedNodeId) {
      window.history.replaceState(null, '', `#${focusedNodeId}`);
    } else {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [focusedNodeId]);

  // Listen for browser back/forward
  useEffect(() => {
    const onHashChange = () => {
      const id = getHashNodeId();
      if (id && nodes.find(n => n.id === id)) {
        setFocusedNodeId(id);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [nodes]);

  const focusedNode = useMemo(
    () => nodes.find(n => n.id === focusedNodeId) || null,
    [nodes, focusedNodeId]
  );

  const connectedEdges = useMemo(() => {
    if (!focusedNodeId) return [];
    return edges.filter(e => {
      const s = typeof e.source === 'object' ? e.source.id : e.source;
      const t = typeof e.target === 'object' ? e.target.id : e.target;
      return s === focusedNodeId || t === focusedNodeId;
    });
  }, [edges, focusedNodeId]);

  const handleNodeClick = useCallback((nodeId) => {
    if (nodeId === null) {
      // Clicking background — deselect
      setFocusedNodeId(null);
      return;
    }
    if (nodeId !== focusedNodeId) {
      if (focusedNodeId) {
        setFocusHistory(prev => [...prev, focusedNodeId]);
      }
      setFocusedNodeId(nodeId);
    }
  }, [focusedNodeId]);

  const handleBack = useCallback(() => {
    if (focusHistory.length > 0) {
      const prev = focusHistory[focusHistory.length - 1];
      setFocusHistory(h => h.slice(0, -1));
      setFocusedNodeId(prev);
    }
  }, [focusHistory]);

  const handleFilterToggle = useCallback((type) => {
    if (type === null) {
      setActiveEdgeTypes(new Set());
      return;
    }
    setActiveEdgeTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Search filtering
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return nodes
      .filter(n => n.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [nodes, searchQuery]);

  const handleSearchSelect = useCallback((nodeId) => {
    handleNodeClick(nodeId);
    setSearchQuery('');
    setSearchOpen(false);
  }, [handleNodeClick]);

  return (
    <div className={styles.explorerContainer}>
      {/* Search bar */}
      <div className={styles.searchContainer}>
        <div className={styles.searchInputWrapper}>
          <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
          </svg>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search concepts..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 200)}
          />
        </div>
        {searchOpen && searchResults.length > 0 && (
          <ul className={styles.searchResults}>
            {searchResults.map(n => (
              <li
                key={n.id}
                className={styles.searchResultItem}
                onMouseDown={() => handleSearchSelect(n.id)}
              >
                <span className={styles.searchDot} style={{
                  backgroundColor: n.hasPage ? (
                    {
                      'relationship-structures': '#0d9488',
                      'relationship-styles': '#7c3aed',
                      'core-concepts': '#6366f1',
                      'healthy-patterns': '#16a34a',
                      'unhealthy-patterns': '#dc2626',
                      'evaluation-tools': '#d97706',
                      'research': '#64748b',
                      'community-context': '#92400e',
                    }[n.category] || '#6366f1'
                  ) : 'transparent',
                  border: n.hasPage ? 'none' : `2px solid ${
                    {
                      'relationship-structures': '#0d9488',
                      'relationship-styles': '#7c3aed',
                      'core-concepts': '#6366f1',
                      'healthy-patterns': '#16a34a',
                      'unhealthy-patterns': '#dc2626',
                      'evaluation-tools': '#d97706',
                      'research': '#64748b',
                      'community-context': '#92400e',
                    }[n.category] || '#6366f1'
                  }`,
                }} />
                {n.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Filter chips */}
      <FilterChips
        activeTypes={activeEdgeTypes}
        onToggle={handleFilterToggle}
      />

      {/* Main content area */}
      <div className={styles.mainArea}>
        {/* Graph */}
        <div className={styles.graphArea}>
          <Graph
            nodes={nodes}
            edges={edges}
            focusedNodeId={focusedNodeId}
            activeEdgeTypes={activeEdgeTypes}
            onNodeClick={handleNodeClick}
            hoveredNodeId={hoveredNodeId}
          />

          {/* Legend */}
          <div className={styles.legend}>
            <details className={styles.legendDetails}>
              <summary className={styles.legendSummary}>Legend</summary>
              <div className={styles.legendContent}>
                <div className={styles.legendSection}>
                  <span className={styles.legendTitle}>Nodes</span>
                  <div className={styles.legendItem}>
                    <span className={styles.legendNodeFilled} /> Has article
                  </div>
                  <div className={styles.legendItem}>
                    <span className={styles.legendNodeOutline} /> Concept only
                  </div>
                </div>
                <div className={styles.legendSection}>
                  <span className={styles.legendTitle}>Categories</span>
                  {[
                    ['#134e4a', '🔗', 'Structures'],
                    ['#3b0764', '💜', 'Styles'],
                    ['#312e81', '💡', 'Core Concepts'],
                    ['#14532d', '✅', 'Healthy'],
                    ['#7f1d1d', '🚩', 'Unhealthy'],
                    ['#78350f', '🧰', 'Evaluation'],
                    ['#334155', '📊', 'Research'],
                    ['#451a03', '👥', 'Community'],
                    ['#27272a', '🔹', 'Adjacent'],
                  ].map(([fill, emoji, label]) => (
                    <div key={label} className={styles.legendItem}>
                      <span style={{
                        width: 16, height: 16, borderRadius: '50%', background: fill,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '8px', flexShrink: 0, lineHeight: 1,
                      }}>{emoji}</span>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className={styles.legendSection}>
                  <span className={styles.legendTitle}>Connections</span>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#6366f1" strokeWidth="2" /></svg>
                    <span>Type of</span>
                  </div>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#d97706" strokeWidth="2" strokeDasharray="6,4" /></svg>
                    <span>Confused with</span>
                  </div>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#dc2626" strokeWidth="2" strokeDasharray="2,3" /></svg>
                    <span>Contrast</span>
                  </div>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#16a34a" strokeWidth="2" /></svg>
                    <span>Can lead to</span>
                  </div>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#64748b" strokeWidth="1" /></svg>
                    <span>Part of</span>
                  </div>
                  <div className={styles.legendItem}>
                    <svg width="24" height="8"><line x1="0" y1="4" x2="24" y2="4" stroke="#9ca3af" strokeWidth="1.5" strokeDasharray="2,4" /></svg>
                    <span>Related</span>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* Info panel (desktop) / Bottom sheet (mobile) */}
        {isMobile ? (
          <MobileSheet
            node={focusedNode}
            edges={connectedEdges}
            allNodes={nodes}
            onNodeClick={handleNodeClick}
            onBack={handleBack}
            canGoBack={focusHistory.length > 0}
          />
        ) : (
          <InfoPanel
            node={focusedNode}
            edges={connectedEdges}
            allNodes={nodes}
            onNodeClick={handleNodeClick}
            onBack={handleBack}
            canGoBack={focusHistory.length > 0}
            onNodeHover={setHoveredNodeId}
          />
        )}
      </div>
    </div>
  );
}

export default function ConceptExplorer() {
  return (
    <BrowserOnly fallback={<div style={{ height: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading explorer...</div>}>
      {() => <ExplorerInner />}
    </BrowserOnly>
  );
}
