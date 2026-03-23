import { useRef, useEffect, useState } from 'react';
import {
  forceSimulation, forceLink, forceManyBody, forceCenter,
  forceCollide, forceX, forceY,
} from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity } from 'd3-zoom';
import { drag } from 'd3-drag';
import 'd3-transition';
import styles from './Graph.module.css';

/* ── Constants ── */

const CATEGORY_COLORS = {
  'relationship-structures': '#0d9488', 'relationship-styles': '#7c3aed',
  'core-concepts': '#6366f1', 'healthy-patterns': '#16a34a',
  'unhealthy-patterns': '#dc2626', 'evaluation-tools': '#d97706',
  'research': '#64748b', 'community-context': '#92400e', 'adjacent': '#52525b',
};
const CATEGORY_FILLS = {
  'relationship-structures': '#134e4a', 'relationship-styles': '#3b0764',
  'core-concepts': '#312e81', 'healthy-patterns': '#14532d',
  'unhealthy-patterns': '#7f1d1d', 'evaluation-tools': '#78350f',
  'research': '#334155', 'community-context': '#451a03', 'adjacent': '#27272a',
};
const CATEGORY_PULSE = {
  'relationship-structures': '#0f766e', 'relationship-styles': '#5b21b6',
  'core-concepts': '#4338ca', 'healthy-patterns': '#166534',
  'unhealthy-patterns': '#991b1b', 'evaluation-tools': '#92400e',
  'research': '#475569', 'community-context': '#78350f', 'adjacent': '#3f3f46',
};
const CATEGORY_EMOJI = {
  'relationship-structures': '🔗', 'relationship-styles': '💜',
  'core-concepts': '💡', 'healthy-patterns': '✅',
  'unhealthy-patterns': '🚩', 'evaluation-tools': '🧰',
  'research': '📊', 'community-context': '👥', 'adjacent': '🔹',
};
const EDGE_STYLES = {
  'is-type-of': { dash: null, color: '#6366f1', colorDark: '#818cf8', arrow: true },
  'often-confused-with': { dash: '6,4', color: '#d97706', colorDark: '#fbbf24', arrow: false },
  'contrast': { dash: '2,3', color: '#dc2626', colorDark: '#f87171', arrow: false },
  'can-lead-to': { dash: null, color: '#16a34a', colorDark: '#4ade80', arrow: true },
  'is-part-of': { dash: null, color: '#64748b', colorDark: '#94a3b8', arrow: false },
  'related': { dash: '2,4', color: '#9ca3af', colorDark: '#6b7280', arrow: false },
};
const EDGE_TYPE_NAMES = {
  'is-type-of': 'Type of', 'often-confused-with': 'Often confused with',
  'contrast': 'Contrast', 'can-lead-to': 'Can lead to',
  'is-part-of': 'Part of', 'related': 'Related',
};
const CLUSTER_POSITIONS = {
  'relationship-structures': { x: -200, y: -150 }, 'relationship-styles': { x: -200, y: 150 },
  'core-concepts': { x: 0, y: 0 }, 'healthy-patterns': { x: 200, y: -150 },
  'unhealthy-patterns': { x: 200, y: 150 }, 'evaluation-tools': { x: 350, y: 0 },
  'research': { x: -350, y: 0 }, 'community-context': { x: 0, y: 300 },
  'adjacent': { x: -300, y: -300 },
};

/* ── Helpers ── */

function eid(e) {
  return {
    s: typeof e.source === 'object' ? e.source.id : e.source,
    t: typeof e.target === 'object' ? e.target.id : e.target,
  };
}
function ecount(nodeId, edges) {
  return edges.filter(e => { const { s, t } = eid(e); return s === nodeId || t === nodeId; }).length;
}
function nrad(nodeId, edges) {
  return Math.max(6, Math.min(12, 5 + ecount(nodeId, edges) * 0.8));
}
function buildAdj(edges) {
  const adj = new Map();
  for (const e of edges) {
    const { s, t } = eid(e);
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s).push(t);
    adj.get(t).push(s);
  }
  return adj;
}
function bfs(nodeId, focusedId, adj) {
  if (!focusedId || nodeId === focusedId) return 0;
  const visited = new Set([focusedId]);
  let frontier = [focusedId];
  for (let d = 1; d <= 4; d++) {
    const next = [];
    for (const id of frontier)
      for (const n of (adj.get(id) || []))
        if (!visited.has(n)) { if (n === nodeId) return d; visited.add(n); next.push(n); }
    frontier = next;
  }
  return 5;
}
function edgeColor(d, dark) {
  const st = EDGE_STYLES[d.type];
  return (dark ? st?.colorDark : st?.color) || '#9ca3af';
}

/* ── Transition duration constant ── */
const T = 500; // ms for all focus transitions

/* ── Component ── */

export default function Graph({ nodes, edges, focusedNodeId, activeEdgeTypes, onNodeClick, hoveredNodeId }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const simRef = useRef(null);
  const zoomRef = useRef(null);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const edgeHitRef = useRef(null);
  // Refs for latest values (used in D3 closures)
  const onClickRef = useRef(onNodeClick); onClickRef.current = onNodeClick;
  const focusRef = useRef(focusedNodeId); focusRef.current = focusedNodeId;
  const [ready, setReady] = useState(false);

  /* ── Init simulation ── */
  useEffect(() => {
    if (!containerRef.current || !svgRef.current || !nodes.length) return;
    let cancelled = false;
    const rafId = requestAnimationFrame(() => {
      if (cancelled) return;
      const svg = select(svgRef.current);
      const { width: w, height: h } = containerRef.current.getBoundingClientRect();

      svg.selectAll('*').remove();

      // Defs
      const defs = svg.append('defs');
      Object.entries(EDGE_STYLES).forEach(([type, st]) => {
        if (st.arrow) {
          defs.append('marker').attr('id', `arrow-${type}`)
            .attr('viewBox', '0 0 10 6').attr('refX', 20).attr('refY', 3)
            .attr('markerWidth', 8).attr('markerHeight', 5).attr('orient', 'auto')
            .append('path').attr('d', 'M0,0L10,3L0,6Z').attr('fill', st.color);
        }
      });
      const glow = defs.append('filter').attr('id', 'node-glow')
        .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      glow.append('feGaussianBlur').attr('stdDeviation', '8').attr('result', 'blur');
      glow.append('feFlood').attr('flood-color', '#818cf8').attr('flood-opacity', '0.8').attr('result', 'color');
      glow.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow');
      const m = glow.append('feMerge'); m.append('feMergeNode').attr('in', 'glow'); m.append('feMergeNode').attr('in', 'SourceGraphic');

      const g = svg.append('g');

      // Zoom
      const zoomB = zoom().scaleExtent([0.2, 5]).on('zoom', e => g.attr('transform', e.transform));
      svg.call(zoomB); svg.on('dblclick.zoom', null);
      zoomRef.current = zoomB;

      // Edges
      const links = g.append('g').selectAll('line').data(edges).join('line')
        .attr('class', d => `edge edge-${d.type}`)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', d => EDGE_STYLES[d.type]?.dash || null)
        .attr('stroke', d => EDGE_STYLES[d.type]?.color || '#9ca3af')
        .attr('marker-end', d => EDGE_STYLES[d.type]?.arrow && !d.bidirectional ? `url(#arrow-${d.type})` : null)
        .style('opacity', 0);

      // Edge hit areas + labels
      const hits = g.append('g').selectAll('line').data(edges).join('line')
        .attr('stroke', 'transparent').attr('stroke-width', 12).style('cursor', 'pointer');
      edgeHitRef.current = hits;

      const edgeLabels = g.append('g').selectAll('text').data(edges).join('text')
        .text(d => EDGE_TYPE_NAMES[d.type] || d.type)
        .attr('text-anchor', 'middle').attr('font-size', '9px')
        .attr('font-family', 'var(--ifm-font-family-base)')
        .attr('fill', '#6b7280').style('pointer-events', 'none').style('opacity', 0);

      hits.on('mouseenter', (_, d) => {
        const { s, t } = eid(d);
        edgeLabels.filter(e => e === d).transition('hover').duration(150).style('opacity', 1);
        links.filter(e => e === d).transition('hover').duration(150).attr('stroke-width', 2);
        svg.selectAll('.node').each(function (nd) {
          if (nd.id !== s && nd.id !== t) return;
          const focused = nd.id === focusRef.current;
          const r = focused ? nrad(nd.id, edges) * 1.8 : nrad(nd.id, edges) * 1.3;
          select(this).select('circle').transition('hover').duration(150).attr('r', r);
          if (!focused) select(this).select('.' + styles.nodeLabel).transition('hover').duration(150).attr('font-size', '11px');
        });
      }).on('mouseleave', (_, d) => {
        const { s, t } = eid(d);
        edgeLabels.filter(e => e === d).transition('hover').duration(200).style('opacity', 0);
        links.filter(e => e === d).transition('hover').duration(200).attr('stroke-width', 1);
        svg.selectAll('.node').each(function (nd) {
          if (nd.id !== s && nd.id !== t) return;
          const focused = nd.id === focusRef.current;
          const r = focused ? nrad(nd.id, edges) * 2 : nrad(nd.id, edges);
          select(this).select('circle').transition('hover').duration(200).attr('r', r);
          if (!focused) select(this).select('.' + styles.nodeLabel).transition('hover').duration(200).attr('font-size', '8px');
        });
      });

      // Nodes
      const nodeGs = g.append('g').selectAll('g').data(nodes, d => d.id).join('g')
        .attr('class', d => `node node-${d.category}`).attr('cursor', 'pointer').style('opacity', 0);

      nodeGs.append('circle')
        .attr('r', d => nrad(d.id, edges))
        .attr('fill', d => d.hasPage ? (CATEGORY_FILLS[d.category] || '#312e81') : 'transparent')
        .attr('stroke', d => d.hasPage ? 'none' : (CATEGORY_COLORS[d.category] || '#6366f1'))
        .attr('stroke-width', d => d.hasPage ? 0 : 2);

      nodeGs.append('text').attr('class', 'node-emoji')
        .text(d => CATEGORY_EMOJI[d.category] || '')
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
        .attr('font-size', '0px').style('pointer-events', 'none').style('opacity', 0);

      nodeGs.append('text').text(d => d.label)
        .attr('dy', d => nrad(d.id, edges) + 12)
        .attr('text-anchor', 'middle').attr('class', styles.nodeLabel).attr('font-size', '8px');

      // Node hover — enlarge on mouseenter, restore on mouseleave
      nodeGs.on('mouseenter', function (_, d) {
        const focused = d.id === focusRef.current;
        const r = focused ? nrad(d.id, edges) * 2.2 : nrad(d.id, edges) * 1.4;
        select(this).select('circle').transition('nodeHover').duration(150).attr('r', r);
        if (!focused) {
          select(this).select('.' + styles.nodeLabel).transition('nodeHover').duration(150).attr('font-size', '11px');
        }
      }).on('mouseleave', function (_, d) {
        const focused = d.id === focusRef.current;
        const r = focused ? nrad(d.id, edges) * 2 : nrad(d.id, edges);
        select(this).select('circle').transition('nodeHover').duration(200).attr('r', r);
        if (!focused) {
          select(this).select('.' + styles.nodeLabel).transition('nodeHover').duration(200).attr('font-size', '8px');
        }
      });

      // Drag + click — 3px threshold to distinguish click from drag
      let dragStartX = 0, dragStartY = 0, didDrag = false, nodeClicked = false;
      nodeGs.call(drag()
        .on('start', (e, d) => {
          didDrag = false; dragStartX = e.x; dragStartY = e.y;
          if (!e.active) simRef.current.alphaTarget(0.15).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (e, d) => {
          const dx = e.x - dragStartX, dy = e.y - dragStartY;
          if (dx * dx + dy * dy > 9) didDrag = true; // 3px threshold
          d.fx = e.x; d.fy = e.y;
        })
        .on('end', (e, d) => {
          if (!e.active) simRef.current.alphaTarget(0);
          d.fx = null; d.fy = null;
          if (!didDrag) {
            nodeClicked = true;
            onClickRef.current(d.id);
            setTimeout(() => { nodeClicked = false; }, 100);
          }
        })
      );
      svg.on('click', () => { if (!nodeClicked) onClickRef.current(null); });

      // Simulation — tuned to settle quickly
      const sim = forceSimulation(nodes)
        .alphaDecay(0.04)      // default 0.0228 — cools faster
        .velocityDecay(0.4)    // default 0.4 — friction
        .alphaMin(0.01)        // stops sooner
        .force('link', forceLink(edges).id(d => d.id).distance(95).strength(0.35))
        .force('charge', forceManyBody().strength(-280))
        .force('center', forceCenter((w || 800) / 2, (h || 600) / 2))
        .force('collide', forceCollide().radius(30))
        .force('clusterX', forceX(d => (CLUSTER_POSITIONS[d.category]?.x || 0) + (w || 800) / 2).strength(0.12))
        .force('clusterY', forceY(d => (CLUSTER_POSITIONS[d.category]?.y || 0) + (h || 600) / 2).strength(0.12));

      sim.on('tick', () => {
        links.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        hits.attr('x1', d => d.source.x).attr('y1', d => d.source.y).attr('x2', d => d.target.x).attr('y2', d => d.target.y);
        edgeLabels.each(function (d) {
          const mx = (d.source.x + d.target.x) / 2, my = (d.source.y + d.target.y) / 2;
          let a = Math.atan2(d.target.y - d.source.y, d.target.x - d.source.x) * (180 / Math.PI);
          if (a > 90 || a < -90) a += 180;
          select(this).attr('x', mx).attr('y', my - 6).attr('transform', `rotate(${a},${mx},${my - 6})`);
        });
        nodeGs.attr('transform', d => `translate(${d.x},${d.y})`);
      });

      simRef.current = sim;
      nodesRef.current = nodes;
      edgesRef.current = edges;

      // Staggered fade-in
      setReady(false);
      const cats = [...new Set(nodes.map(n => n.category))];
      const cDel = 100, cDur = 400, eStart = 3 * cDel, eDel = 60, eDur = 350;
      setTimeout(() => {
        cats.forEach((cat, i) => {
          nodeGs.filter(d => d.category === cat).transition('intro').delay(i * cDel).duration(cDur).style('opacity', 1);
        });
        const eTypes = [...new Set(edges.map(e => e.type))];
        eTypes.forEach((type, i) => {
          links.filter(d => d.type === type).transition('intro').delay(eStart + i * eDel).duration(eDur).style('opacity', 0.25);
        });
        const total = Math.max(cats.length * cDel + cDur, eStart + eTypes.length * eDel + eDur);
        setTimeout(() => setReady(true), total + 150);
      }, 400);
    });
    return () => { cancelled = true; cancelAnimationFrame(rafId); if (simRef.current) simRef.current.stop(); };
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Focus/filter effect ── */
  useEffect(() => {
    if (!ready) return;
    const svg = select(svgRef.current);
    if (!svg.node() || !nodesRef.current.length) return;

    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const adj = buildAdj(edgesRef.current);
    const unfocusing = !focusedNodeId;

    // ── Nodes ──
    svg.selectAll('.node').each(function (d) {
      const el = select(this);
      const dist = bfs(d.id, focusedNodeId, adj);
      const focused = d.id === focusedNodeId;
      const baseR = nrad(d.id, edgesRef.current);
      const circle = el.select('circle');
      const emoji = el.select('.node-emoji');
      const label = el.select('.' + styles.nodeLabel);

      // Remove any existing pulse
      circle.selectAll('animate').remove();

      if (unfocusing) {
        // Stagger restore by category
        const cats = [...new Set(nodesRef.current.map(n => n.category))];
        const delay = cats.indexOf(d.category) * 80;
        el.style('pointer-events', 'all');
        // Restore fill
        circle.attr('fill', d.hasPage ? (CATEGORY_FILLS[d.category] || '#312e81') : 'transparent');
        el.transition('focus').delay(delay).duration(600).style('opacity', 1);
        circle.transition('focus').delay(delay).duration(600).attr('r', baseR).attr('filter', null);
        emoji.transition('focus').delay(delay).duration(300).attr('font-size', '0px').style('opacity', 0);
        label.transition('focus').delay(delay).duration(600).attr('font-size', '8px').style('opacity', 1);
      } else {
        let opacity = 1;
        if (focusedNodeId) {
          opacity = dist <= 1 ? (dist === 0 ? 1 : 0.9) : 0;
        }
        el.style('pointer-events', opacity > 0 ? 'all' : 'none');
        el.transition('focus').duration(T).style('opacity', opacity);

        // Circle
        if (focused) {
          const dk = CATEGORY_FILLS[d.category] || '#312e81';
          const pk = CATEGORY_PULSE[d.category] || '#4338ca';
          circle.transition('focus').duration(T).attr('r', baseR * 2).attr('filter', 'url(#node-glow)')
            .on('end', function () {
              select(this).append('animate')
                .attr('attributeName', 'fill').attr('values', `${dk};${pk};${dk}`)
                .attr('dur', '2s').attr('repeatCount', 'indefinite');
            });
        } else {
          circle.transition('focus').duration(T).attr('r', baseR).attr('filter', null);
        }

        // Emoji
        if (focused) emoji.transition('focus').duration(T).attr('font-size', '16px').style('opacity', 1);
        else if (dist <= 1) emoji.transition('focus').duration(T).attr('font-size', '10px').style('opacity', 0.8);
        else emoji.transition('focus').duration(T * 0.6).attr('font-size', '0px').style('opacity', 0);

        // Label
        if (focused) label.transition('focus').duration(T).attr('font-size', '13px').style('opacity', 1);
        else if (dist <= 1) label.transition('focus').duration(T).attr('font-size', '11px').style('opacity', 1);
        else label.transition('focus').duration(T * 0.6).attr('font-size', '7px').style('opacity', 0);
      }
    });

    // ── Edges ──
    // Two-phase: fade out → change stroke → fade in. Prevents gradient-to-color pop.
    const fadeOut = T * 0.4;
    const fadeIn = T * 0.6;
    const trailBatch = `tb-${Date.now()}`; // unique batch ID for this focus change

    // Remove OLD trailing gradients immediately (not the ones we're about to create)
    svg.select('defs').selectAll('.trail-grad:not(.' + trailBatch + ')').remove();

    svg.selectAll('.edge').each(function (d, i) {
      const el = select(this);
      const { s, t } = eid(d);
      const colorVal = edgeColor(d, dark);
      const st = EDGE_STYLES[d.type];
      const marker = st?.arrow && !d.bidirectional ? `url(#arrow-${d.type})` : null;

      if (unfocusing) {
        // Fade out, reset to solid color, fade in at resting opacity
        el.transition('focus').duration(fadeOut).style('opacity', 0)
          .on('end', function () {
            select(this).attr('stroke', colorVal).attr('marker-end', marker).attr('stroke-width', 1);
          })
          .transition().delay(50).duration(fadeIn).style('opacity', 0.25);
        return;
      }

      const sDist = bfs(s, focusedNodeId, adj);
      const tDist = bfs(t, focusedNodeId, adj);
      const connected = focusedNodeId && (s === focusedNodeId || t === focusedNodeId);
      const bothVis = sDist <= 1 && tDist <= 1;
      const oneVis = (sDist <= 1 && tDist > 1) || (tDist <= 1 && sDist > 1);
      const typeOk = activeEdgeTypes.size === 0 || activeEdgeTypes.has(d.type);

      // Compute target state
      let targetOp = 0, targetSw = 1.5, targetStroke = colorVal, targetMarker = null;

      if (connected) {
        targetOp = typeOk ? 1 : 0.15;
        targetSw = 1.8;
        targetMarker = marker;
        targetStroke = colorVal;
      } else if (bothVis) {
        targetOp = typeOk ? 0.3 : 0.05;
        targetStroke = colorVal;
      } else if (oneVis && focusedNodeId) {
        // Trailing gradient
        const sN = nodesRef.current.find(n => n.id === s);
        const tN = nodesRef.current.find(n => n.id === t);
        if (sN?.x != null && tN?.x != null) {
          const vis = sDist <= 1 ? 'source' : 'target';
          const gid = `trail-${i}`;
          const grad = svg.select('defs').append('linearGradient')
            .attr('class', `trail-grad ${trailBatch}`).attr('id', gid)
            .attr('gradientUnits', 'userSpaceOnUse')
            .attr('x1', vis === 'source' ? sN.x : tN.x).attr('y1', vis === 'source' ? sN.y : tN.y)
            .attr('x2', vis === 'source' ? tN.x : sN.x).attr('y2', vis === 'source' ? tN.y : sN.y);
          grad.append('stop').attr('offset', '0%').attr('stop-color', colorVal).attr('stop-opacity', 0.35);
          grad.append('stop').attr('offset', '35%').attr('stop-color', colorVal).attr('stop-opacity', 0.1);
          grad.append('stop').attr('offset', '50%').attr('stop-color', colorVal).attr('stop-opacity', 0);
          targetStroke = `url(#${gid})`;
          targetOp = typeOk ? 1 : 0.15;
          targetSw = 0.75;
        }
      }
      // else: targetOp stays 0 (hidden)

      // Phase 1: fade out. Phase 2: set new stroke + fade in.
      el.transition('focus').duration(fadeOut).style('opacity', 0)
        .on('end', function () {
          select(this)
            .attr('stroke', targetStroke)
            .attr('stroke-width', targetSw)
            .attr('marker-end', targetMarker);
        })
        .transition().delay(50).duration(fadeIn).style('opacity', targetOp);
    });

    // Edge hit areas
    if (edgeHitRef.current) {
      edgeHitRef.current.each(function (d) {
        const { s, t } = eid(d);
        if (unfocusing) { select(this).style('pointer-events', 'all'); return; }
        if (focusedNodeId) {
          const both = bfs(s, focusedNodeId, adj) <= 1 && bfs(t, focusedNodeId, adj) <= 1;
          select(this).style('pointer-events', both ? 'all' : 'none');
        }
      });
    }

    // ── Zoom to fit ──
    if (focusedNodeId && zoomRef.current) {
      const fn = nodesRef.current.find(n => n.id === focusedNodeId);
      if (fn?.x != null) {
        const nbs = new Set(adj.get(focusedNodeId) || []); nbs.add(focusedNodeId);
        const rel = nodesRef.current.filter(n => nbs.has(n.id) && n.x != null);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const n of rel) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y); }
        const pad = 80; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
        const { width: cw, height: ch } = containerRef.current?.getBoundingClientRect() || {};
        const ww = cw || 800, hh = ch || 600;
        const sc = Math.min(ww / (x1 - x0), hh / (y1 - y0), 2.0);
        const ox = window.innerWidth > 768 ? -160 : 0;
        select(svgRef.current).transition('zoom').duration(700)
          .call(zoomRef.current.transform, zoomIdentity.translate(ww / 2 + ox, hh / 2).scale(sc).translate(-(x0 + x1) / 2, -(y0 + y1) / 2));
      }
    } else if (!focusedNodeId && zoomRef.current) {
      select(svgRef.current).transition('zoom').duration(700).call(zoomRef.current.transform, zoomIdentity);
    }
  }, [focusedNodeId, activeEdgeTypes, ready]);

  /* ── Panel hover highlight ── */
  useEffect(() => {
    if (!ready) return;
    const svg = select(svgRef.current);
    if (!svg.node()) return;
    svg.selectAll('.node').each(function (d) {
      const circle = select(this).select('circle');
      if (d.id === hoveredNodeId) {
        circle.transition('panelHover').duration(200).attr('r', nrad(d.id, edgesRef.current) * 1.4).attr('filter', 'url(#node-glow)');
      } else if (d.id === focusedNodeId) {
        circle.transition('panelHover').duration(200).attr('r', nrad(d.id, edgesRef.current) * 2).attr('filter', 'url(#node-glow)');
      } else {
        circle.transition('panelHover').duration(200).attr('r', nrad(d.id, edgesRef.current)).attr('filter', null);
      }
    });
  }, [hoveredNodeId, ready, focusedNodeId]);

  return (
    <div ref={containerRef} className={styles.graphContainer}>
      <svg ref={svgRef} className={styles.graphSvg} />
    </div>
  );
}
