import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

const wikiCategories = [
  {
    title: 'Foundational Concepts',
    description: 'Core ideas and frameworks for understanding ethical non-monogamy.',
    link: '/docs/category/foundational-concepts',
  },
  {
    title: 'Common Myths',
    description: 'Misconceptions about polyamory and non-monogamy, examined honestly.',
    link: '/docs/category/common-myths',
  },
  {
    title: 'Community Stories',
    description: 'Real experiences from real people navigating non-traditional relationships.',
    link: '/docs/category/community-stories',
  },
  {
    title: 'Research & Sources',
    description: 'Studies, articles, and references for deeper understanding.',
    link: '/docs/category/research--sources',
  },
];

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary')}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className="hero-buttons">
          <Link className="button button--lg hero-button" to="/blog">
            Read the Blog
          </Link>
          <Link className="button button--lg hero-button" to="/docs/intro">
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
  return (
    <section className="homepage-section">
      <div className="container">
        <Heading as="h2" className="homepage-section__title">Explore the Wiki</Heading>
        <div className="row">
          {wikiCategories.map((cat) => (
            <div key={cat.title} className="col col--6" style={{marginBottom: '1rem'}}>
              <Link to={cat.link} className="card-link">
                <div className="homepage-card">
                  <Heading as="h3" className="homepage-card__title">{cat.title}</Heading>
                  <p className="homepage-card__desc">{cat.description}</p>
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
  return (
    <section className="homepage-section homepage-section--alt">
      <div className="container" style={{textAlign: 'center'}}>
        <Heading as="h2" className="homepage-section__title">From the Blog</Heading>
        <p style={{maxWidth: '600px', margin: '0 auto 1.5rem'}}>
          Articles, perspectives, and analysis from community contributors.
        </p>
        <Link className="button button--primary button--lg" to="/blog">
          Read the Blog
        </Link>
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
      title="Home"
      description="Community-built resources for healthier relationships">
      <HomepageHeader />
      <main>
        <WikiCategories />
        <FromTheBlog />
        <ContributeCTA />
      </main>
    </Layout>
  );
}
