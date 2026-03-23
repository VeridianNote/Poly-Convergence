import styles from './FilterChips.module.css';

const EDGE_TYPES = [
  {
    type: 'is-type-of',
    label: 'Type of',
    color: '#6366f1',
    lineStyle: 'solid',
  },
  {
    type: 'often-confused-with',
    label: 'Often confused with',
    color: '#d97706',
    lineStyle: 'dashed',
  },
  {
    type: 'contrast',
    label: 'Contrast',
    color: '#dc2626',
    lineStyle: 'dotted',
  },
  {
    type: 'can-lead-to',
    label: 'Can lead to',
    color: '#16a34a',
    lineStyle: 'gradient',
  },
  {
    type: 'is-part-of',
    label: 'Part of',
    color: '#64748b',
    lineStyle: 'thin-solid',
  },
  {
    type: 'related',
    label: 'Related',
    color: '#9ca3af',
    lineStyle: 'light-dotted',
  },
];

function EdgeIndicator({ color, lineStyle }) {
  const baseStyle = {
    display: 'inline-block',
    width: '18px',
    height: '2px',
    borderRadius: '1px',
    flexShrink: 0,
    verticalAlign: 'middle',
  };

  if (lineStyle === 'gradient') {
    return (
      <span
        style={{
          ...baseStyle,
          background: `linear-gradient(to right, transparent, ${color})`,
        }}
      />
    );
  }

  if (lineStyle === 'solid') {
    return <span style={{ ...baseStyle, backgroundColor: color }} />;
  }

  if (lineStyle === 'thin-solid') {
    return <span style={{ ...baseStyle, height: '1px', backgroundColor: color }} />;
  }

  // dashed, dotted, light-dotted — render as a small SVG line for accuracy
  const dashArray =
    lineStyle === 'dashed'
      ? '4 2'
      : lineStyle === 'dotted'
      ? '1.5 2'
      : '1 3'; // light-dotted

  return (
    <svg
      width="18"
      height="4"
      viewBox="0 0 18 4"
      aria-hidden="true"
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      <line
        x1="0"
        y1="2"
        x2="18"
        y2="2"
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dashArray}
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function FilterChips({ activeTypes, onToggle }) {
  const allActive = activeTypes.size === 0;

  function handleAll() {
    // Clear all active types — parent is responsible for resetting the Set
    if (!allActive) {
      // Toggle off all: call onToggle for each active type to clear them,
      // or better — pass null as a sentinel for "clear all"
      onToggle(null);
    }
  }

  return (
    <div className={styles.row} role="group" aria-label="Filter by connection type">
      {/* All chip */}
      <button
        className={`${styles.chip} ${allActive ? styles.chipActive : ''}`}
        onClick={handleAll}
        aria-pressed={allActive}
      >
        All
      </button>

      {EDGE_TYPES.map(({ type, label, color, lineStyle }) => {
        const active = activeTypes.has(type);
        return (
          <button
            key={type}
            className={`${styles.chip} ${active ? styles.chipActive : ''}`}
            style={active ? { '--chip-color': color } : { '--chip-color': color }}
            onClick={() => onToggle(type)}
            aria-pressed={active}
          >
            <EdgeIndicator color={active ? '#fff' : color} lineStyle={lineStyle} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
