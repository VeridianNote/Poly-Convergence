// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Poly Convergence',
  tagline: 'Community-driven education and accountability in relationship advice',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://polyconvergence.com',
  baseUrl: '/',

  organizationName: 'VeridianNote',
  projectName: 'Poly-Convergence',
  deploymentBranch: 'gh-pages',
  trailingSlash: false,

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/VeridianNote/Poly-Convergence/edit/main/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl:
            'https://github.com/VeridianNote/Poly-Convergence/edit/main/',
          blogTitle: 'Blog',
          blogDescription: 'Articles examining relationship advice claims with evidence and community experiences.',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'Poly Convergence',
        items: [
          {to: '/blog', label: 'Blog', position: 'left'},
          {
            type: 'docSidebar',
            sidebarId: 'wikiSidebar',
            position: 'left',
            label: 'Wiki',
          },
          {to: '/about', label: 'About', position: 'left'},
          {href: 'pathname:///contribute/', label: 'Contribute', position: 'left'},
          {
            href: 'https://github.com/VeridianNote/Poly-Convergence',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Content',
            items: [
              {
                label: 'Blog',
                to: '/blog',
              },
              {
                label: 'Wiki',
                to: '/docs/intro',
              },
            ],
          },
          {
            title: 'About',
            items: [
              {
                label: 'About This Site',
                to: '/about',
              },
              {
                label: 'Contribute',
                href: 'pathname:///contribute/',
              },
              {
                label: 'Contributor Guide',
                to: '/contributing',
              },
              {
                label: 'Disclaimer',
                to: '/disclaimer',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/VeridianNote/Poly-Convergence',
              },
              {
                label: 'Content License',
                to: '/content-license',
              },
            ],
          },
        ],
        copyright: `Content licensed under CC BY-NC-SA 4.0. Code licensed under MIT. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
