import clsx from 'clsx';
import {useState, useEffect} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {usePluginData} from '@docusaurus/useGlobalData';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const ENGAGEMENT_THRESHOLD = 10;

const TAGLINES = [
  'Real guidance for real relationships. Built by the community.',
  'Where relationship shape doesn\'t determine relationship ethics.',
  'What the poly community builds when everyone\'s welcome.',
  'The resource we wish we\'d had when we started.',
  'For people building relationships the world doesn\'t have a script for.',
  'Relationship advice that doesn\'t start with \'you\'re doing it wrong.\'',
  'More nuance than a subreddit. More heart than a textbook.',
  'Practical. Honest. Built by people who\'ve actually done this.',
  'Not here to tell you how to love. Here to help you do it well.',
  'The conversation the poly community should have been having all along.',
  'Where your relationship structure isn\'t a moral judgment.',
  'Built by the community. Driven by experience. Open to everyone.',
  'Community-built. No shame. No gatekeeping.',
  'The poly resources that should have existed all along. Built by the people living it.',
];

const wikiCategories = [
  {
    title: 'Foundational Concepts',
    emoji: '\u{1F9ED}',
    description: 'Core ideas and frameworks for understanding ethical non-monogamy.',
    link: '/wiki/category/foundational-concepts',
    folder: 'foundational-concepts',
  },
  {
    title: 'Common Myths',
    emoji: '\u{1F50D}',
    description: 'Misconceptions about polyamory and non-monogamy, examined honestly.',
    link: '/wiki/category/common-myths',
    folder: 'common-myths',
  },
  {
    title: 'Community Stories',
    emoji: '\u{1F4AC}',
    description: 'Real experiences from real people navigating non-traditional relationships.',
    link: '/wiki/category/community-stories',
    folder: 'community-stories',
  },
  {
    title: 'Research & Sources',
    emoji: '\u{1F4DA}',
    description: 'Studies, articles, and references for deeper understanding.',
    link: '/wiki/category/research--sources',
    folder: 'research-and-sources',
  },
];

function getApiUrl() {
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return 'http://localhost:8787';
  }
  return 'https://api.polyconvergence.com';
}

function EngagementBadges({likes, shares}) {
  if ((!likes || likes < ENGAGEMENT_THRESHOLD) && (!shares || shares < ENGAGEMENT_THRESHOLD)) {
    return null;
  }
  return (
    <div className="homepage-card__engagement">
      {likes >= ENGAGEMENT_THRESHOLD && (
        <span>{'\uD83D\uDC4D'} {likes}</span>
      )}
      {shares >= ENGAGEMENT_THRESHOLD && (
        <span>{'\uD83D\uDD17'} {shares}</span>
      )}
    </div>
  );
}

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  const [tagline, setTagline] = useState(null);
  useEffect(() => {
    setTagline(TAGLINES[Math.floor(Math.random() * TAGLINES.length)]);
  }, []);
  return (
    <header className={clsx('hero hero--primary')}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className={clsx('hero__subtitle', tagline && 'hero__subtitle--visible')}>
          {tagline || '\u00A0'}
        </p>
        <div className="hero-buttons">
          <Link className="button button--lg hero-button" to="/stories">
            Read Stories
          </Link>
          <Link className="button button--lg hero-button" to="/wiki/intro">
            Browse the Wiki
          </Link>
          <Link className="button button--lg hero-button" to="/contribute">
            Contribute
          </Link>
        </div>
      </div>
    </header>
  );
}

function WikiCategories() {
  // Try to get doc counts per category from global data
  let docCounts = {};
  try {
    const docsData = usePluginData('docusaurus-plugin-content-docs');
    if (docsData?.versions?.[0]?.docs) {
      docsData.versions[0].docs.forEach((doc) => {
        const folder = doc.id.split('/')[0];
        if (folder && folder !== doc.id) {
          docCounts[folder] = (docCounts[folder] || 0) + 1;
        }
      });
    }
  } catch {
    // Graceful fallback — just don't show counts
  }

  return (
    <section className="homepage-section">
      <div className="container">
        <Heading as="h2" className="homepage-section__title">Explore the Wiki</Heading>
        <div className="row">
          {wikiCategories.map((cat) => (
            <div key={cat.title} className="col col--6" style={{marginBottom: '1rem'}}>
              <Link to={cat.link} className="card-link">
                <div className="homepage-card">
                  <div className="homepage-card__header">
                    <span className="homepage-card__emoji">{cat.emoji}</span>
                    <Heading as="h3" className="homepage-card__title">{cat.title}</Heading>
                  </div>
                  <p className="homepage-card__desc">{cat.description}</p>
                  {docCounts[cat.folder] > 0 && (
                    <span className="homepage-card__count">
                      {docCounts[cat.folder]} {docCounts[cat.folder] === 1 ? 'article' : 'articles'}
                    </span>
                  )}
                </div>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FromTheBlog() {
  let recentPosts = [];
  try {
    const blogData = usePluginData('blog-global-data');
    if (blogData?.recentPosts) {
      recentPosts = blogData.recentPosts;
    }
  } catch {
    // Graceful fallback
  }

  // Fetch engagement counts for blog posts
  const [engagementCounts, setEngagementCounts] = useState({});
  useEffect(() => {
    if (recentPosts.length === 0) return;
    const slugs = recentPosts.map(p => p.permalink).join(',');
    fetch(getApiUrl() + '/api/reactions/batch?slugs=' + encodeURIComponent(slugs))
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.counts) setEngagementCounts(data.counts);
      })
      .catch(() => {});
  }, [recentPosts.length]);

  return (
    <section className="homepage-section homepage-section--alt">
      <div className="container">
        <Heading as="h2" className="homepage-section__title" style={{textAlign: 'center'}}>
          Recent Stories
        </Heading>
        {recentPosts.length > 0 ? (
          <>
            <div className="row">
              {recentPosts.map((post) => {
                const counts = engagementCounts[post.permalink] || {};
                return (
                  <div key={post.permalink} className={clsx('col', recentPosts.length === 2 ? 'col--6' : 'col--4')} style={{marginBottom: '1rem'}}>
                    <Link to={post.permalink} className="card-link">
                      <div className="homepage-card blog-card">
                        <Heading as="h3" className="homepage-card__title">
                          {post.title}
                        </Heading>
                        {post.authors?.length > 0 && (
                          <div className="card-author">
                            {post.authors.map((author, i) => (
                              <div key={i} className="card-author__item">
                                {author.image_url && (
                                  <img className="card-author__avatar" src={author.image_url} alt={author.name} loading="lazy" />
                                )}
                                <span className="card-author__name">{author.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="blog-card__meta">
                          <time dateTime={post.date}>
                            {new Date(post.date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </time>
                          {post.readingTime != null && (
                            <span> &middot; {Math.ceil(post.readingTime)} min read</span>
                          )}
                        </div>
                        {post.description && (
                          <p className="homepage-card__desc">{post.description}</p>
                        )}
                        <EngagementBadges likes={counts.likes} shares={counts.shares} />
                        <span className="blog-card__link">Read article &#8594;</span>
                      </div>
                    </Link>
                  </div>
                );
              })}
            </div>
            <div style={{textAlign: 'center', marginTop: '1rem'}}>
              <Link className="button button--primary button--lg" to="/stories">
                View All Stories
              </Link>
            </div>
          </>
        ) : (
          <div style={{textAlign: 'center'}}>
            <p style={{maxWidth: '600px', margin: '0 auto 1.5rem'}}>
              Articles, perspectives, and analysis from community contributors.
            </p>
            <Link className="button button--primary button--lg" to="/stories">
              Read Stories
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

function ContributeCTA() {
  return (
    <section className="homepage-section">
      <div className="container" style={{textAlign: 'center'}}>
        <Heading as="h2" className="homepage-section__title">Help Build This Resource</Heading>
        <p style={{maxWidth: '600px', margin: '0 auto 1.5rem'}}>
          This site is built by the community. If you have knowledge to share,
          a myth to bust, or a story to tell — we'd love your contribution.
        </p>
        <Link className="button button--primary button--lg" to="/contribute">
          Start Contributing
        </Link>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title=""
      description="Community-built resources for healthier relationships">
      <HomepageHeader />
      <main>
        <FromTheBlog />
        <WikiCategories />
        <ContributeCTA />
      </main>
    </Layout>
  );
}
