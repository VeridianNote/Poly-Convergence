// @ts-check

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Poly Convergence',
  tagline: 'Community-built resources for healthier poly relationships',
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

  // API URL for the Cloudflare Worker backend
  customFields: {
    apiUrl: process.env.API_URL || 'https://api.polyconvergence.com',
  },

  onBrokenLinks: 'throw',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  clientModules: ['./src/progress-bar.js'],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  plugins: [
    // Expose recent blog posts as global data for the homepage
    function blogGlobalDataPlugin(context) {
      const fs = require('fs');
      const path = require('path');
      return {
        name: 'blog-global-data',
        async loadContent() {
          const blogDir = path.join(context.siteDir, 'blog');
          const files = fs.readdirSync(blogDir)
            .filter(f => f.endsWith('.md') || f.endsWith('.mdx'))
            .sort().reverse();
          return files.slice(0, 3).map(file => {
            const raw = fs.readFileSync(path.join(blogDir, file), 'utf8');
            const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
            if (!fmMatch) return null;
            const fm = {};
            fmMatch[1].split('\n').forEach(line => {
              const idx = line.indexOf(':');
              if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            });
            const body = raw.slice(fmMatch[0].length).trim();
            const truncIdx = body.indexOf('<!-- truncate -->');
            const excerpt = truncIdx > 0 ? body.slice(0, truncIdx).trim() : body.slice(0, 200).trim();
            const slug = fm.slug || file.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.mdx?$/, '');
            const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
            return {title: fm.title || slug, permalink: '/blog/' + slug, date: dateMatch?.[1] || '', description: excerpt};
          }).filter(Boolean);
        },
        async contentLoaded({content, actions}) {
          actions.setGlobalData({recentPosts: content});
        },
      };
    },
  ],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: ({docPath}) => `/contribute?edit=docs/${docPath}`,
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: ({blogPath}) => `/contribute?edit=blog/${blogPath}`,
          blogTitle: 'Blog',
          blogDescription: 'Articles and perspectives from community contributors.',
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
          {to: '/contribute', label: 'Contribute', position: 'left'},
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
            title: 'Explore',
            items: [
              {label: 'Blog', to: '/blog'},
              {label: 'Wiki', to: '/docs/intro'},
              {label: 'Contribute', to: '/contribute'},
            ],
          },
          {
            title: 'Info',
            items: [
              {label: 'About', to: '/about'},
              {label: 'Disclaimer', to: '/disclaimer'},
              {label: 'GitHub', href: 'https://github.com/VeridianNote/Poly-Convergence'},
            ],
          },
        ],
        copyright: `Content: CC BY-NC-SA 4.0 · Code: MIT`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
