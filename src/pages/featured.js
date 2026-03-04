import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import Layout from '@theme/Layout';

export default function FeaturedPage() {
  let allPosts = [];
  try {
    const data = usePluginData('blog-global-data');
    if (data?.allPosts) allPosts = data.allPosts;
  } catch {
    // Graceful fallback
  }

  const featured = allPosts.filter(p => p.tags?.includes('featured'));

  return (
    <Layout
      title="Featured Stories"
      description="Editor-selected stories from the Poly Convergence community."
    >
      <div className="container margin-vert--lg">
        <h1>Featured Stories</h1>
        <p className="stories-intro">
          Hand-picked stories that showcase the best of the community --
          perspectives that resonate, challenge, and inspire.
        </p>

        {featured.length > 0 ? (
          <>
            {/* Hero — newest featured post */}
            <Link to={featured[0].permalink} className="card-link">
              <article className="featured-hero">
                <h2 className="featured-hero__title">{featured[0].title}</h2>
                {featured[0].date && (
                  <div className="story-card__meta">
                    <time dateTime={featured[0].date}>
                      {new Date(featured[0].date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </time>
                  </div>
                )}
                {featured[0].description && (
                  <p className="featured-hero__desc">{featured[0].description}</p>
                )}
                <span className="blog-card__link">Read story &#8594;</span>
              </article>
            </Link>

            {/* Remaining featured posts */}
            {featured.length > 1 && (
              <div className="stories-grid" style={{marginTop: '2rem'}}>
                {featured.slice(1).map(post => (
                  <Link key={post.permalink} to={post.permalink} className="card-link">
                    <article className="story-card">
                      <h3 className="story-card__title">{post.title}</h3>
                      {post.date && (
                        <div className="story-card__meta">
                          <time dateTime={post.date}>
                            {new Date(post.date).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </time>
                        </div>
                      )}
                      {post.description && (
                        <p className="story-card__desc">{post.description}</p>
                      )}
                    </article>
                  </Link>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="stories-empty">
            <p>Featured stories coming soon.</p>
            <p>
              In the meantime, check out all{' '}
              <Link to="/stories">Community Stories</Link>.
            </p>
          </div>
        )}
      </div>
    </Layout>
  );
}
