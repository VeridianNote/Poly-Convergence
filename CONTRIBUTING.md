# Contributing to Poly Convergence

Thank you for your interest in contributing. This guide explains how to submit content, what standards we follow, and how to protect your privacy.

## How to Submit Content

All contributions are made through GitHub pull requests:

1. **Fork** the [repository](https://github.com/VeridianNote/Poly-Convergence)
2. **Clone** your fork locally
3. **Create a branch** for your contribution (e.g., `add-myth-soulmates` or `story-my-experience`)
4. **Add or edit** content in the appropriate directory
5. **Commit** your changes with a clear commit message
6. **Push** your branch and open a **pull request** against `main`

If you're new to GitHub, [GitHub's guide to forking](https://docs.github.com/en/get-started/quickstart/fork-a-repo) is a good place to start.

## Where to Put Content

| Content Type | Directory | Format |
|---|---|---|
| Blog posts (analysis, debunking) | `blog/` | `YYYY-MM-DD-slug.md` |
| Wiki pages (educational) | `docs/<category>/` | `your-topic.md` |
| Community stories | `docs/community-stories/` | `your-title.md` |

### Blog Post Frontmatter

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

### Wiki Page Frontmatter

```markdown
---
sidebar_position: 10
title: Your Page Title
---

# Your Page Title

Content here.
```

## Markdown Formatting Guidelines

- Use standard Markdown (`.md` files)
- Use `#` for the page title, `##` for sections, `###` for subsections
- Use `>` blockquotes for quoting external sources — always include attribution
- Use numbered lists for sequential steps, bullet lists for unordered items
- Use `**bold**` for emphasis, not ALL CAPS
- Keep paragraphs focused — one idea per paragraph
- Add blank lines between sections for readability

## Image Handling

### EXIF Stripping — Required

**All images must have EXIF data stripped before submission.** EXIF data can contain GPS coordinates, device information, timestamps, and other metadata that can identify you or others.

Tools for stripping EXIF data:
- **ExifTool** (command line): `exiftool -all= image.jpg`
- **GIMP**: Export the image and uncheck "Save EXIF data"
- **Online tools**: Use a trusted EXIF remover (be aware that you're uploading the image to a third party)

### Image Placement

- Place images in `static/img/` organized by content type (e.g., `static/img/blog/`, `static/img/docs/`)
- Use descriptive filenames: `claim-comparison-chart.png` not `screenshot1.png`
- Reference images in markdown: `![Alt text description](/img/blog/your-image.png)`
- Use reasonable file sizes — compress images before submitting
- **Never** include images that show faces, real names, or identifying information without explicit consent

## Privacy and Anonymity

**Your safety matters.** Consider the following before contributing:

- You do not need to use your real name or real GitHub account
- Creating a pseudonymous GitHub account for contributions is encouraged
- Do not include your own or anyone else's personally identifying information in content
- Strip EXIF data from all images (see above)
- Be aware that your GitHub account's commit history and activity are public
- If sharing a personal story, consider whether any details could identify you or others

## Content Standards

### Do

- Present documented facts with sources
- Cite academic research, published articles, or archived public statements
- Share genuine personal experiences (in community stories)
- Use neutral, factual language
- Acknowledge uncertainty — if something is your interpretation, say so
- Provide context for quotes and claims

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
- If a claim cannot be independently verified, state that clearly

## License Agreement

By submitting a pull request to this repository, you agree to the following:

- **Content** (articles, wiki pages, stories, images) is licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)
- **Code** (configuration, scripts, templates) is licensed under the [MIT License](LICENSE)
- You confirm that you have the right to submit this content under these terms
- You understand that contributions are public and will be attributed to your GitHub account

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). In short: be respectful, be factual, and prioritize the safety of community members.

## Questions?

If you have questions about contributing, [open an issue](https://github.com/VeridianNote/Poly-Convergence/issues) on GitHub.
