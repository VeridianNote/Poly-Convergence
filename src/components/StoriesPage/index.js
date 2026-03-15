import {useState, useMemo} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

const TAG_CATEGORIES = [
  {
    label: 'Topic',
    tags: [
      'jealousy', 'communication', 'boundaries', 'dating', 'family', 'growth',
      'breakup', 'coming-out', 'happy-memories', 'favorite-moments',
      'lessons-learned', 'overcoming-challenges',
    ],
  },
  {
    label: 'Structure',
    tags: ['solo-poly', 'couple', 'vee', 'triad', 'quad', 'polycule'],
  },
  {
    label: 'Style',
    tags: ['open', 'closed', 'hierarchical', 'non-hierarchical', 'swinging', 'married'],
  },
  {
    label: 'Editorial',
    tags: ['announcements', 'community', 'education', 'debunking', 'research'],
  },
];

// Tags that should not appear as visible badges on cards
const HIDDEN_TAGS = new Set(['featured']);

// All browseable tags (flattened from categories)
const ALL_CATEGORY_TAGS = new Set(TAG_CATEGORIES.flatMap(c => c.tags));

function tagLabel(tag) {
  return tag
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function StoryCard({item}) {
  const {metadata} = item.content;
  const {title, permalink, date, readingTime, description, tags} = metadata;
  const normalizeTag = t => (t.label || '').toLowerCase().replace(/\s+/g, '-');
  const visibleTags = (tags || []).filter(
    t => { const n = normalizeTag(t); return !HIDDEN_TAGS.has(n) && ALL_CATEGORY_TAGS.has(n); },
  );

  return (
    <Link to={permalink} className="card-link">
      <article className="story-card">
        <h3 className="story-card__title">{title}</h3>
        {metadata.authors?.length > 0 && (
          <div className="card-author">
            {metadata.authors.map((author, i) => (
              <div key={i} className="card-author__item">
                {author.imageURL && (
                  <img className="card-author__avatar" src={author.imageURL} alt={author.name} loading="lazy" />
                )}
                <span className="card-author__name">{author.name}</span>
              </div>
            ))}
          </div>
        )}
        <div className="story-card__meta">
          <time dateTime={date}>
            {new Date(date).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
          {readingTime != null && (
            <span> &middot; {Math.ceil(readingTime)} min read</span>
          )}
        </div>
        {description && <p className="story-card__desc">{description}</p>}
        {visibleTags.length > 0 && (
          <div className="story-card__tags">
            {visibleTags.map(t => (
              <span key={t.label} className="story-card__tag">
                {tagLabel(t.label)}
              </span>
            ))}
          </div>
        )}
      </article>
    </Link>
  );
}

export default function StoriesPage(props) {
  const {items} = props;
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState(new Set());
  const [sortNewest, setSortNewest] = useState(true);

  const toggleTag = (tag) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setActiveTags(new Set());
  };

  const filtered = useMemo(() => {
    let result = [...items];

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(item => {
        const {title, description} = item.content.metadata;
        return (
          title.toLowerCase().includes(q) ||
          (description && description.toLowerCase().includes(q))
        );
      });
    }

    // Tag filter — post must have ALL selected tags
    if (activeTags.size > 0) {
      result = result.filter(item => {
        const postTags = new Set(
          (item.content.metadata.tags || []).map(t =>
            (t.label || '').toLowerCase().replace(/\s+/g, '-'),
          ),
        );
        for (const tag of activeTags) {
          if (!postTags.has(tag)) return false;
        }
        return true;
      });
    }

    // Sort
    result.sort((a, b) => {
      const da = new Date(a.content.metadata.date);
      const db = new Date(b.content.metadata.date);
      return sortNewest ? db - da : da - db;
    });

    return result;
  }, [items, search, activeTags, sortNewest]);

  const hasFilters = search.trim() || activeTags.size > 0;

  return (
    <Layout
      title="Community Stories"
      description="Stories, perspectives, and lived experience from the community."
    >
      <div className="container margin-vert--lg">
        <h1>Community Stories</h1>
        <p className="stories-intro">
          Real experiences from real people navigating non-traditional
          relationships. Every story is different -- that's the point.
        </p>

        {/* Search + Sort */}
        <div className="stories-controls">
          <input
            className="stories-search"
            type="text"
            placeholder="Search stories..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button
            className="button button--sm button--secondary"
            onClick={() => setSortNewest(v => !v)}
            title={sortNewest ? 'Showing newest first' : 'Showing oldest first'}
          >
            {sortNewest ? 'Newest first' : 'Oldest first'}
          </button>
        </div>

        {/* Tag filters */}
        <div className="stories-tags">
          {TAG_CATEGORIES.map(cat => (
            <div key={cat.label} className="stories-tag-group">
              <span className="stories-tag-group__label">{cat.label}</span>
              <div className="stories-tag-group__chips">
                {cat.tags.map(tag => (
                  <button
                    key={tag}
                    className={`stories-tag-chip${activeTags.has(tag) ? ' stories-tag-chip--active' : ''}`}
                    onClick={() => toggleTag(tag)}
                  >
                    {tagLabel(tag)}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {hasFilters && (
            <button
              className="button button--sm button--outline button--primary stories-clear-btn"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Results */}
        {filtered.length > 0 ? (
          <>
            <p className="stories-count">
              {filtered.length} {filtered.length === 1 ? 'story' : 'stories'}
              {hasFilters ? ' matching your filters' : ''}
            </p>
            <div className="stories-grid">
              {filtered.map(item => (
                <StoryCard key={item.content.metadata.permalink} item={item} />
              ))}
            </div>
          </>
        ) : (
          <div className="stories-empty">
            <p>No stories match your filters.</p>
            <button
              className="button button--primary"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </Layout>
  );
}
