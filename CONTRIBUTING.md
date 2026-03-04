# Contributing to Poly Convergence

Thanks for wanting to contribute. Whether you're sharing a personal story, writing a wiki article, or fixing something that's wrong -- this site gets better every time someone adds what they know.

## The Easy Way: Web Editor

The fastest way to contribute is through the [web editor on the site](https://polyconvergence.com/contribute). Sign in with GitHub, pick a content type, write, and submit. No Git knowledge needed.

- Your submission becomes a pull request automatically
- EXIF data is stripped from images for your privacy
- Everything gets reviewed before it goes live

## The Git Way: Fork and PR

If you prefer working with Git directly:

1. **Fork** the [repository](https://github.com/VeridianNote/Poly-Convergence)
2. **Clone** your fork locally
3. **Create a branch** for your contribution (e.g., `add-myth-soulmates` or `story-my-experience`)
4. **Add or edit** content in the appropriate directory
5. **Commit** your changes with a clear commit message
6. **Push** your branch and open a **pull request** against `main`

New to GitHub? [GitHub's guide to forking](https://docs.github.com/en/get-started/quickstart/fork-a-repo) is a good place to start.

## What You Can Contribute

- **Wiki articles** -- Reference content covering relationship concepts, communication tools, research summaries, and practical guidance. Goes in `docs/<category>/`.
- **Blog posts** -- Longer pieces exploring a topic, examining a claim, or sharing a perspective. Goes in `blog/`.
- **Community stories** -- First-hand accounts from your own experience. These don't need a tidy ending -- they need to be real. Goes in `docs/community-stories/`.
- **Corrections and improvements** -- Spot something wrong or incomplete? Fix it. That's just as valuable as writing something new.

## Where to Put Content (Git contributors)

| Content Type | Directory | Format |
|---|---|---|
| Blog posts | `blog/` | `YYYY-MM-DD-slug.md` |
| Wiki pages | `docs/<category>/` | `your-topic.md` |
| Community stories | `docs/community-stories/` | `your-title.md` |

### Blog post frontmatter

```markdown
---
slug: your-post-slug
title: Your Post Title
authors: [editors]
tags: [debunking, education, community, or research]
---

Your intro paragraph here.

<!-- truncate -->

The rest of your post.
```

### Wiki page frontmatter

```markdown
---
sidebar_position: 10
title: Your Page Title
---

# Your Page Title

Content here.
```

## Markdown Formatting

- Use standard Markdown (`.md` files)
- Use `#` for the page title, `##` for sections, `###` for subsections
- Use `>` blockquotes for quoting external sources -- always include attribution
- Use numbered lists for sequential steps, bullet lists for unordered items
- Use `**bold**` for emphasis, not ALL CAPS
- Use double dashes (`--`) instead of em dashes
- Keep paragraphs focused -- one idea per paragraph

## Images

### EXIF stripping

**All images must have EXIF data stripped before submission.** EXIF data can contain GPS coordinates, device information, and timestamps that can identify you or others. The web editor handles this automatically. If submitting via Git, strip EXIF data yourself:

- **ExifTool** (command line): `exiftool -all= image.jpg`
- **GIMP**: Export and uncheck "Save EXIF data"

### Image placement

- Place images in `static/img/` organized by content type (e.g., `static/img/stories/`, `static/img/wiki/`)
- Use descriptive filenames: `claim-comparison-chart.png` not `screenshot1.png`
- Reference in markdown: `![Alt text description](/img/stories/your-image.png)`
- Keep images under 2MB
- **Never** include images showing faces, real names, or identifying information without explicit consent

## Privacy

**Your safety matters.** Consider the following before contributing:

- You don't need to use your real name or real GitHub account
- Creating a pseudonymous GitHub account for contributions is encouraged
- Don't include your own or anyone else's personally identifying information in content
- Strip EXIF data from all images (see above)
- Your GitHub account's commit history and activity are public
- If sharing a personal story, consider whether any details could identify you or others

## Content Standards

### Do

- Be honest. Share what you actually know and experienced. If you're speculating, say so.
- Source your claims. If citing research, link to your sources. It's fine to say "I don't have a source for this, but here's what I've observed" -- just be clear about the difference.
- Respect privacy. Avoid real names or identifying details that could out someone without their consent.
- Acknowledge uncertainty -- if something is your interpretation, say so.
- Provide context for quotes and claims.

### Don't

- Make personal attacks or use derogatory language
- Include doxxing, threats, or harassment of any kind
- Fabricate or exaggerate claims
- Present opinion as established fact without evidence
- Include anyone's private information (addresses, phone numbers, private messages without consent, etc.)

### Sourcing

- Link to primary sources whenever possible
- Use [Internet Archive](https://web.archive.org/) links for sources that may be deleted or changed
- Clearly distinguish between direct quotes, paraphrased claims, and your own analysis
- If a claim can't be independently verified, state that clearly

## License

By submitting content to this project, you agree to the following:

- **Content** (articles, wiki pages, stories, images) is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- **Code** (configuration, scripts, templates) is licensed under the [MIT License](LICENSE)
- You confirm that you have the right to submit this content under these terms
- You understand that contributions are public and will be attributed to your GitHub account

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Short version: be respectful, be factual, and prioritize the safety of community members.

## Questions?

If you have questions about contributing, [open an issue](https://github.com/VeridianNote/Poly-Convergence/issues) on GitHub.
