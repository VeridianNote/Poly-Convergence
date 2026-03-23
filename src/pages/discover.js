import Layout from '@theme/Layout';
import ConceptExplorer from '../components/ConceptExplorer';

export default function DiscoverPage() {
  return (
    <Layout
      title="Discover"
      description="Explore polyamory and non-monogamy concepts through an interactive knowledge graph."
      noFooter
    >
      <ConceptExplorer />
    </Layout>
  );
}
