# notion-sync

A library of Astro components and a Notion sync script for running a blog powered by Notion as a CMS. Pull your articles from Notion, generate a local JSON file, and render them with drop-in Astro components — no external build service, no API calls at runtime, no MCP or tokens use.

## How it works

```
Notion database ──► sync/notion-sync.js ──► src/data/articles.json
                                                  │
                                                  ▼
                                    Astro components at build time
                                    (DigestArticle, TimelineArticle,
                                     ArticleCard, NextArticle, ...)
```

The sync script is a one-time Node script you run locally (or in CI) whenever you publish new content. It writes a JSON file that Astro imports statically at build time — so the site itself makes zero Notion API calls.

---

## Quick start

### 1. Copy this library into your Astro project

```bash
# from your Astro project root
cp -r path/to/notion-sync src/notion-sync
```

Or install it as a git submodule:

```bash
git submodule add https://github.com/renmaiv/notion-sync src/notion-sync
```

### 2. Install dependencies

```bash
npm install @notionhq/client dotenv
```

### 3. Configure Notion

1. Create a Notion integration (Personal Access Token, free) at <https://www.notion.so/my-integrations> and copy the secret (`ntn_...`).
2. Copy the database ID from the URL: `notion.so/<workspace>/<DATABASE_ID>?v=...`

Add to `.env`:

```env
NOTION_API_KEY=ntn_xxx
NOTION_ARTICLES_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 4. Set up your Notion database

Your database needs these properties (exact names matter — or change them in `CONFIG.props` inside `sync/notion-sync.js`):

| Property name   | Notion type       | Purpose                                      |
|-----------------|-------------------|----------------------------------------------|
| Title           | Title             | Article title                                |
| Slug            | Text              | URL slug, e.g. `my-first-post`               |
| Status          | Status            | `Published`, `WIP`, or `Ever-Updating`       |
| Select          | Select            | Article type: `timeline` or `digest`         |
| Subtitle        | Text              | One-liner shown on cards (optional)          |
| Date Published  | Date              | Publication date                             |
| Show on Index   | Checkbox          | Whether to show on the blog index            |
| Card Media      | URL               | Image or `.mp4` URL for the card thumbnail   |
| Card Width      | Text              | CSS width of the card, e.g. `312px`          |
| Card AR         | Text              | CSS aspect-ratio, e.g. `312/236`             |
| Next Override   | Relation (self)   | Manually point to the next article (optional)|

### 5. Write your article content in Notion

**Timeline articles** (long-form writing with a table of contents):

Open the Notion page for your article and write with these block types:

| Notion block   | Becomes                              |
|----------------|--------------------------------------|
| Heading 1      | `<h2>` section (appears in TOC)      |
| Heading 3      | `<h3>` sub-heading (nested in TOC)   |
| Paragraph      | `<p>` — supports bold, italic, code, links |
| Quote          | `<blockquote>` — add a nested paragraph for the `<cite>` |
| Image          | `<figure>` with caption              |
| Bulleted list  | `<ul>`                               |
| Heading 4 starting with `[article summary block` | Pulled out as the dropcap summary paragraph (not part of the body) |

**Digest articles** (a grid of image + text pairs):

Alternate Image blocks and Synced Blocks. Each Synced Block should contain:
- A Heading 3 → item title
- A Paragraph → item description

### 6. Run the sync script

```bash
node src/notion-sync/sync/notion-sync.js
```

This writes `src/data/articles.json` and downloads article images to `public/blog/`.

Wire it into `package.json`:

```json
"scripts": {
  "sync": "node src/notion-sync/sync/notion-sync.js",
  "build": "npm run sync && astro build"
}
```

### 7. Create your Astro pages

**Blog index page** (`src/pages/blog/index.astro`):

```astro
---
import ArticleCard from 'src/notion-sync/components/ArticleCard.astro';
import 'src/notion-sync/styles/notion2astro.css';
import data from 'src/data/articles.json';

const cards = data.articles.filter((a) => a.showOnIndex);
---
<div class="blog-grid">
  {cards.map((article) => (
    <ArticleCard article={article} basePath="/blog" />
  ))}
</div>
```

**Article page** (`src/pages/blog/[slug].astro`):

```astro
---
import DigestArticle from 'src/notion-sync/components/DigestArticle.astro';
import TimelineArticle from 'src/notion-sync/components/TimelineArticle.astro';
import 'src/notion-sync/styles/notion2astro.css';
import data from 'src/data/articles.json';

export function getStaticPaths() {
  return data.articles
    .filter((a) => a.status !== 'wip')
    .map((article) => ({ params: { slug: article.slug }, props: { article } }));
}

const { article } = Astro.props;
---
{article.type === 'timeline'
  ? <TimelineArticle article={article} basePath="/blog" />
  : <DigestArticle article={article} basePath="/blog" />}
```

---

## Components

### `ArticleCard.astro`

A blog index card. Articles with status `wip` render without a link; all others link to `/[basePath]/[slug]/`.

```astro
<ArticleCard article={article} basePath="/blog" />
```

Props:
- `article` — one article object from the JSON
- `basePath` — URL prefix for links (default: `"/blog"`)

---

### `TimelineArticle.astro`

Long-form article with a sticky table of contents. The TOC is built automatically from `[data-section]` headings in the body and highlights the active section as you scroll.

```astro
<TimelineArticle article={article} basePath="/blog" />
```

**Slots:**
- `header` — override the default title + meta block
- `footer` — inject content after the body, before the next-article card

---

### `DigestArticle.astro`

A responsive grid of image + text pairs, for link-digest or roundup posts.

```astro
<DigestArticle article={article} basePath="/blog" />
```

**Slots:**
- `header` — override the default title + meta block
- `footer` — inject content after the grid, before the next-article card

---

### `NextArticle.astro`

The "next article" card shown at the bottom of each article. Renders nothing if `next` is null.

```astro
<NextArticle next={article.next} basePath="/blog" />
```

---

### `ArticleBlock.astro`

Renders a single block from a timeline article's `body[]`. Useful when you want to render blocks one at a time or wrap them individually.

```astro
{body.map((block) => <ArticleBlock block={block} />)}
```

---

### `RichText.astro`

Renders an inline `runs[]` array (bold, italic, code, links) without `set:html`.

```astro
<p><RichText runs={block.runs} /></p>
```

---

## Styles

Import `styles/notion2astro.css` once in your layout. All classes are prefixed with `n2a-` to avoid collisions.

Override the design with CSS custom properties:

```css
:root {
  --n2a-color-muted: #666;
  --n2a-color-toc-active: #000;
  --n2a-toc-width: 180px;
  --n2a-article-gap: 3rem;
  --n2a-digest-gap: 1.5rem;
}
```

Full list of custom properties is documented at the top of `styles/notion2astro.css`.

---

## Data model reference

The JSON file produced by the sync script has this shape:

```json
{
  "articles": [
    {
      "slug": "my-first-post",
      "type": "timeline",
      "status": "published",
      "title": "My First Post",
      "pageTitle": "My First Post — My Site",
      "subtitle": "A short description",
      "datePublished": "2026-07-01",
      "readMinutes": 4,
      "card": {
        "media": "/blog/my-first-post/cover.jpg",
        "width": "312px",
        "ar": "312/236"
      },
      "showOnIndex": true,
      "summary": "The dropcap opening paragraph for timeline articles.",
      "body": [
        { "kind": "h2", "text": "Section heading" },
        { "kind": "h3", "text": "Sub-heading" },
        { "kind": "p",  "text": "Plain paragraph." },
        { "kind": "p",  "runs": ["Text with ", { "strong": "bold" }, " and ", { "em": "italic" }] },
        { "kind": "quote", "text": "A quoted passage.", "cite": "Author Name" },
        { "kind": "figure", "src": "/blog/my-first-post/img.jpg", "alt": "Caption", "caption": "Caption" },
        { "kind": "ul", "items": ["First item", ["Item with ", { "code": "inline code" }]] }
      ],
      "next": {
        "slug": "my-second-post",
        "title": "My Second Post",
        "subtitle": "Another short description",
        "media": "/blog/assets/cover2.jpg",
        "datePublished": "2026-07-15"
      }
    }
  ]
}
```

For `digest` articles, `body` is instead:

```json
"body": [
  { "media": "/blog/my-digest/img1.jpg", "title": "Item heading", "desc": "Item description" }
]
```

---

## Automation with GitHub Actions

Run the sync on a schedule to keep your blog fresh without manual deploys:

```yaml
# .github/workflows/notion-sync.yml
name: Notion sync
on:
  schedule:
    - cron: '0 6 * * *'   # every day at 06:00 UTC
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: node src/notion-sync/sync/notion-sync.js
        env:
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          NOTION_ARTICLES_DB_ID: ${{ secrets.NOTION_ARTICLES_DB_ID }}
      - name: Commit updated articles.json
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add src/data/articles.json public/blog/
          git diff --staged --quiet || git commit -m "chore: sync articles from Notion"
          git push
```

Add `NOTION_API_KEY` and `NOTION_ARTICLES_DB_ID` as repository secrets in GitHub → Settings → Secrets.
