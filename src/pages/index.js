import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary')}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div style={{display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem'}}>
          <Link
            className="button button--secondary button--lg"
            to="/blog">
            Read the Blog
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Browse the Wiki
          </Link>
          <a
            className="button button--secondary button--lg"
            href="/contribute/">
            Contribute
          </a>
        </div>
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title="Home"
      description="Community-driven education and accountability in relationship advice">
      <HomepageHeader />
      <main>
        <section style={{padding: '3rem 0'}}>
          <div className="container">
            <div className="row">
              <div className="col col--4" style={{marginBottom: '2rem'}}>
                <Heading as="h3">Evidence-Based</Heading>
                <p>Claims are examined against documented facts, research, and real-world outcomes. Sources are cited wherever possible.</p>
              </div>
              <div className="col col--4" style={{marginBottom: '2rem'}}>
                <Heading as="h3">Community-Driven</Heading>
                <p>Anyone can contribute through our online editor or via GitHub. Content is reviewed before publishing to maintain quality and accuracy.</p>
              </div>
              <div className="col col--4" style={{marginBottom: '2rem'}}>
                <Heading as="h3">Privacy-First</Heading>
                <p>Contributors can remain anonymous. All images have EXIF data stripped automatically. No personally identifying information is published.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
