#!/usr/bin/env node
/**
 * notion-sync.js
 * ---------------
 * Pulls articles from a Notion database and writes them to a local JSON file
 * that your Astro components can import at build time.
 *
 * SETUP
 * -----
 * 1. Create a Notion integration at https://www.notion.so/my-integrations
 *    and copy the "Internal Integration Secret" (starts with ntn_).
 * 2. Share your Notion database with the integration (open the DB in Notion →
 *    ··· → Connections → add your integration).
 * 3. Copy the database ID from its URL:
 *      https://www.notion.so/<workspace>/<DATABASE_ID>?v=...
 * 4. Add to your .env file:
 *      NOTION_API_KEY=ntn_xxx
 *      NOTION_ARTICLES_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 * 5. Install deps: npm install @notionhq/client dotenv
 * 6. Run: node src/notion2astro/sync/notion-sync.js
 *
 * NOTION DATABASE SCHEMA
 * ----------------------
 * Your Notion database needs these properties (exact names, or edit CONFIG below):
 *
 *   Title            — Title property       — article title
 *   Slug             — Text                 — URL slug, e.g. "my-first-post"
 *   Status           — Status               — "Published", "WIP", or "Ever-Updating"
 *   Select           — Select               — article type: "timeline" or "digest"
 *   Subtitle         — Text                 — optional one-liner shown on cards
 *   Date Published   — Date                 — publication date
 *   Show on Index    — Checkbox             — include in the blog index listing
 *   Card Media       — URL                  — image/video URL for the index card
 *   Card Width       — Text                 — CSS width of the card, e.g. "312px"
 *   Card AR          — Text                 — CSS aspect-ratio, e.g. "312/236"
 *   Next Override    — Relation (self)      — optional: manually set the next article
 *
 * ARTICLE BODY FORMAT IN NOTION
 * ------------------------------
 * For "timeline" articles — write content as regular Notion blocks:
 *   - Heading 1  → h2 section heading (gets a TOC entry)
 *   - Heading 3  → h3 sub-heading (nested in TOC)
 *   - Paragraph  → paragraph (supports bold, italic, code, links)
 *   - Quote      → blockquote (optionally with a nested paragraph as the cite)
 *   - Image      → figure with caption
 *   - Bulleted list → <ul>
 *   - Heading 4 starting with "[article summary block" → pulled out as the
 *     article's dropcap summary paragraph (not part of body[])
 *
 * For "digest" articles — alternate Image / Synced Block pairs:
 *   Each pair becomes one { media, title, desc } item in body[].
 *   The Synced Block should contain a Heading 3 (title) and a Paragraph (desc).
 *
 * OUTPUT
 * ------
 * Writes `src/data/articles.json` (configurable via CONFIG.outFile).
 * Downloaded images land in `public/blog/<slug>/` (configurable via CONFIG.publicDir).
 *
 * The output shape is documented in the notion2astro README.md.
 */

import 'dotenv/config';
import { Client } from '@notionhq/client';
import {
  existsSync, mkdirSync, writeFileSync, readdirSync,
} from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CONFIG — edit these to match your project layout and Notion property names
// ---------------------------------------------------------------------------

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const CONFIG = {
  // Where to write the articles JSON (imported by your Astro pages)
  outFile: join(ROOT, 'src', 'data', 'articles.json'),

  // Public dir where downloaded images are saved
  publicDir: join(ROOT, 'public', 'blog'),

  // URL prefix for the saved images (as referenced from the browser)
  publicUrlPrefix: '/blog',

  // Notion database property names — change if yours differ
  props: {
    title: 'Title',
    slug: 'Slug',
    status: 'Status',
    type: 'Select',
    subtitle: 'Subtitle',
    datePublished: 'Date Published',
    showOnIndex: 'Show on Index',
    cardMedia: 'Card Media',
    cardWidth: 'Card Width',
    cardAr: 'Card AR',
    nextOverride: 'Next Override',
  },

  // Optional: suffix appended to <title> in every article's pageTitle field.
  // Set to '' to disable.
  siteName: '',
};

// ---------------------------------------------------------------------------
// Env / auth
// ---------------------------------------------------------------------------

const { NOTION_API_KEY, NOTION_ARTICLES_DB_ID } = process.env;

if (!NOTION_API_KEY || !NOTION_ARTICLES_DB_ID) {
  console.error(
    [
      'Missing NOTION_API_KEY and/or NOTION_ARTICLES_DB_ID.',
      '',
      'Add them to a .env file at the repo root:',
      '',
      '  NOTION_API_KEY=ntn_xxx',
      '  NOTION_ARTICLES_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    ].join('\n'),
  );
  process.exit(1);
}

const notion = new Client({ auth: NOTION_API_KEY, notionVersion: '2022-06-28' });

// ---------------------------------------------------------------------------
// Notion API helpers
// ---------------------------------------------------------------------------

async function queryDatabase(databaseId) {
  const results = [];
  let cursor;
  for (;;) {
    const res = await notion.request({
      path: `databases/${databaseId}/query`,
      method: 'post',
      body: cursor ? { start_cursor: cursor } : {},
    });
    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

async function listBlockChildren(blockId) {
  const results = [];
  let cursor;
  for (;;) {
    const res = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
    });
    results.push(...res.results);
    if (!res.has_more) break;
    cursor = res.next_cursor;
  }
  return results;
}

// ---------------------------------------------------------------------------
// Property extractors
// ---------------------------------------------------------------------------

function plainText(richText) {
  return (richText || []).map((t) => t.plain_text).join('');
}

function propTitle(props, name)      { const p = props[name]; return p?.type === 'title'      ? plainText(p.title)       : ''; }
function propRichText(props, name)   { const p = props[name]; return p?.type === 'rich_text'  ? plainText(p.rich_text)   : ''; }
function propSelect(props, name)     { const p = props[name]; return p?.type === 'select'     ? p.select?.name ?? ''     : ''; }
function propStatus(props, name)     { const p = props[name]; return p?.type === 'status'     ? p.status?.name ?? ''     : ''; }
function propDate(props, name)       { const p = props[name]; return p?.type === 'date'       ? p.date?.start ?? null    : null; }
function propUrl(props, name)        { const p = props[name]; return p?.type === 'url'        ? p.url ?? ''              : ''; }
function propCheckbox(props, name)   { const p = props[name]; return p?.type === 'checkbox'   ? !!p.checkbox             : false; }
function propRelationFirst(props, name) {
  const p = props[name];
  return p?.type === 'relation' && p.relation?.length ? p.relation[0].id : null;
}

function normalizeId(id) { return (id || '').replace(/-/g, ''); }

// ---------------------------------------------------------------------------
// Inline rich_text → runs
// ---------------------------------------------------------------------------

/**
 * Converts a Notion rich_text[] into a compact "runs" array.
 * Returns a plain string when the entire segment is unstyled (common case),
 * or a Run[] when any annotations are present.
 * See RichText.astro for the rendering counterpart.
 */
function richTextToRuns(richText) {
  const runs = [];
  let plainBuffer = '';

  const flush = () => { if (plainBuffer) { runs.push(plainBuffer); plainBuffer = ''; } };

  for (const rt of richText || []) {
    const text = rt.plain_text;
    if (!text) continue;
    const href = rt.href || rt.text?.link?.url || null;
    const ann = rt.annotations || {};

    if (href) {
      flush(); runs.push({ a: text, href }); continue;
    }
    if (ann.code) {
      flush(); runs.push({ code: text }); continue;
    }
    if (ann.bold) {
      flush(); runs.push({ strong: text }); continue;
    }
    if (ann.italic) {
      flush(); runs.push({ em: text }); continue;
    }
    plainBuffer += text;
  }
  flush();

  // If the result is a single plain string, return it directly.
  if (runs.length === 1 && typeof runs[0] === 'string') return runs[0];
  if (!runs.length) return '';
  return runs;
}

/** Returns runs[] or a plain string, for use in body builder output. */
function textOrRuns(richText) {
  const result = richTextToRuns(richText);
  return result;
}

// ---------------------------------------------------------------------------
// Word-count helpers (for readMinutes estimation)
// ---------------------------------------------------------------------------

function wordsOf(str) {
  if (!str || typeof str !== 'string') return 0;
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function wordsInRunsOrText(value) {
  if (!value) return 0;
  if (typeof value === 'string') return wordsOf(value);
  if (Array.isArray(value)) {
    return value.reduce((sum, r) => {
      const text = typeof r === 'string' ? r : (r.a || r.code || r.em || r.strong || r.text || '');
      return sum + wordsOf(text);
    }, 0);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Image download helpers
// ---------------------------------------------------------------------------

function extFromUrl(url) {
  try { return extname(new URL(url).pathname).toLowerCase(); } catch { return ''; }
}

function extFromContentType(ct) {
  const map = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg',
    'image/avif': '.avif', 'video/mp4': '.mp4',
  };
  return map[(ct || '').split(';')[0].trim().toLowerCase()] || '';
}

function findExistingDownload(dir, blockId) {
  if (!existsSync(dir)) return null;
  const match = readdirSync(dir).find((f) => f.startsWith(`${blockId}.`));
  return match ? join(dir, match) : null;
}

/**
 * Download a Notion-hosted image into public/blog/<slug>/<blockId>.<ext>.
 * Returns the root-absolute URL path (e.g. /blog/<slug>/<blockId>.jpg).
 * Already-local paths are returned unchanged. Idempotent: existing files
 * are reused without re-downloading. Falls back to the original URL on error.
 */
async function downloadImage(url, slug, blockId) {
  if (!url) return url;
  if (url.startsWith('/')) return url;

  const dir = join(CONFIG.publicDir, slug);
  const existing = findExistingDownload(dir, blockId);
  if (existing) return `${CONFIG.publicUrlPrefix}/${slug}/${existing.split('/').pop()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = extFromUrl(url) || extFromContentType(res.headers.get('content-type')) || '.jpg';
    mkdirSync(dir, { recursive: true });
    const filename = `${blockId}${ext}`;
    writeFileSync(join(dir, filename), buf);
    return `${CONFIG.publicUrlPrefix}/${slug}/${filename}`;
  } catch (err) {
    console.warn(`  ! image download failed for block ${blockId}: ${err.message}`);
    return url;
  }
}

// ---------------------------------------------------------------------------
// Block-level helpers
// ---------------------------------------------------------------------------

function blockText(block) {
  const data = block[block.type];
  return data?.rich_text ? plainText(data.rich_text) : '';
}

function imageUrl(block) {
  const img = block.image;
  if (!img) return '';
  return img.type === 'external' ? img.external.url : img.file.url;
}

function imageCaption(block) {
  const img = block.image;
  return img ? plainText(img.caption) : '';
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

/**
 * Digest body: alternate (image, synced_block) pairs in the Notion page.
 * Each pair → { media, title, desc } in body[].
 */
async function buildDigestBody(blocks, slug) {
  const body = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.type !== 'image') continue;
    const next = blocks[i + 1];
    if (!next || next.type !== 'synced_block') continue;

    const children = await listBlockChildren(next.id);
    const headingBlock = children.find((b) => b.type === 'heading_3');
    const paraBlock = children.find((b) => b.type === 'paragraph');

    const media = await downloadImage(imageUrl(block), slug, block.id);
    body.push({
      media,
      title: headingBlock ? blockText(headingBlock) : '',
      desc: paraBlock ? blockText(paraBlock) : '',
    });
    i += 1;
  }
  return body;
}

const SUMMARY_MARKER_RE = /^\[article summary block[^\]]*\]/i;

/**
 * Timeline body: typed Notion blocks → { summary, body: Block[] }.
 * Block kinds: h2, h3, p, quote, figure, ul.
 */
async function buildTimelineBody(blocks, slug) {
  const body = [];
  let summary = '';

  // Pre-compute which paragraphs are duplicates of a following image caption
  // (Notion sometimes duplicates the caption as a paragraph before the image).
  const nextImageCaption = new Array(blocks.length).fill(null);
  for (let i = 0; i < blocks.length - 1; i += 1) {
    if (blocks[i + 1].type === 'image') nextImageCaption[i] = imageCaption(blocks[i + 1]);
  }

  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];

    // [article summary block...] marker in heading_4 → extract summary text
    if (block.type === 'heading_4') {
      const text = blockText(block);
      if (SUMMARY_MARKER_RE.test(text)) {
        summary = text.replace(SUMMARY_MARKER_RE, '').trim();
        i++; continue;
      }
    }

    if (block.type === 'heading_1') { body.push({ kind: 'h2', text: blockText(block) }); i++; continue; }
    if (block.type === 'heading_3') { body.push({ kind: 'h3', text: blockText(block) }); i++; continue; }

    if (block.type === 'paragraph') {
      const followingCaption = nextImageCaption[i];
      if (followingCaption !== null && blockText(block) === followingCaption) { i++; continue; }
      const value = textOrRuns(block.paragraph.rich_text);
      body.push(typeof value === 'string' ? { kind: 'p', text: value } : { kind: 'p', runs: value });
      i++; continue;
    }

    if (block.type === 'quote') {
      const text = blockText(block);
      let cite = '';
      if (block.has_children) {
        const children = await listBlockChildren(block.id);
        const citeBlock = children.find((b) => b.type === 'paragraph');
        cite = citeBlock ? blockText(citeBlock) : '';
      }
      body.push({ kind: 'quote', text, cite });
      i++; continue;
    }

    if (block.type === 'image') {
      const caption = imageCaption(block);
      const src = await downloadImage(imageUrl(block), slug, block.id);
      body.push({ kind: 'figure', src, alt: caption, caption });
      i++; continue;
    }

    if (block.type === 'bulleted_list_item') {
      const items = [];
      while (i < blocks.length && blocks[i].type === 'bulleted_list_item') {
        items.push(textOrRuns(blocks[i].bulleted_list_item.rich_text));
        i++;
      }
      body.push({ kind: 'ul', items });
      continue;
    }

    i++;
  }
  return { summary, body };
}

// ---------------------------------------------------------------------------
// Read-time estimation
// ---------------------------------------------------------------------------

function computeReadMinutes(type, article) {
  let words = 0;
  if (type === 'digest') {
    for (const b of article.body) words += wordsOf(b.title) + wordsOf(b.desc);
  } else {
    words += wordsOf(article.summary);
    for (const b of article.body) {
      if (b.kind === 'p' || b.kind === 'h2' || b.kind === 'h3') {
        words += wordsInRunsOrText(b.runs ?? b.text);
      } else if (b.kind === 'quote') {
        words += wordsOf(b.text) + wordsOf(b.cite);
      } else if (b.kind === 'ul') {
        words += b.items.reduce((s, item) => s + wordsInRunsOrText(item), 0);
      }
    }
  }
  return Math.max(1, Math.round(words / 200));
}

// ---------------------------------------------------------------------------
// Build one article from a Notion page row
// ---------------------------------------------------------------------------

async function buildArticle(page) {
  const props = page.properties;
  const P = CONFIG.props;

  const slug = propRichText(props, P.slug);
  const type = propSelect(props, P.type).toLowerCase();
  const status = propStatus(props, P.status).toLowerCase();
  const title = propTitle(props, P.title);
  const subtitle = propRichText(props, P.subtitle);
  const datePublished = propDate(props, P.datePublished);
  const cardMedia = propUrl(props, P.cardMedia);
  const cardWidth = propRichText(props, P.cardWidth);
  const cardAr = propRichText(props, P.cardAr);
  const showOnIndex = propCheckbox(props, P.showOnIndex);

  if (!slug) {
    console.warn(`  ! skipping page "${title}" — no Slug value`);
    return null;
  }

  console.log(`  fetching blocks for "${title}" (${slug})...`);
  const blocks = await listBlockChildren(page.id);

  const article = { slug, type, status, title };
  if (CONFIG.siteName) article.pageTitle = `${title} — ${CONFIG.siteName}`;
  if (subtitle) article.subtitle = subtitle;
  if (datePublished) article.datePublished = datePublished;
  article.card = { media: cardMedia, width: cardWidth, ar: cardAr };
  article.showOnIndex = showOnIndex;

  if (type === 'digest') {
    article.body = await buildDigestBody(blocks, slug);
  } else {
    const { summary, body } = await buildTimelineBody(blocks, slug);
    if (summary) article.summary = summary;
    article.body = body;
  }

  article.readMinutes = computeReadMinutes(type, article);
  article.next = null;

  return {
    article,
    pageId: page.id,
    nextOverrideId: propRelationFirst(props, P.nextOverride),
  };
}

// ---------------------------------------------------------------------------
// Compute next-article links
// ---------------------------------------------------------------------------

/**
 * Populate article.next for every article. Rules:
 *   1. If a "Next Override" relation points at a valid (non-wip) article → use it.
 *   2. Otherwise: the next chronologically newer article (wraps from newest to oldest).
 *
 * `built` is sorted newest-first before this is called.
 */
function computeNext(built) {
  const targets = built.filter((b) => b.article.status !== 'wip');
  const byPageId = new Map(built.map((b) => [normalizeId(b.pageId), b]));

  const toCard = (t) => {
    const a = t.article;
    const card = { slug: a.slug, title: a.title };
    if (a.subtitle) card.subtitle = a.subtitle;
    card.media = a.card.media;
    if (a.datePublished) card.datePublished = a.datePublished;
    return card;
  };

  for (const b of built) {
    if (b.article.status === 'wip') { b.article.next = null; continue; }

    let target = null;
    if (b.nextOverrideId) {
      const ov = byPageId.get(normalizeId(b.nextOverrideId));
      if (ov && ov.article.status !== 'wip') target = ov;
    }

    if (!target && targets.length > 1) {
      const idx = targets.indexOf(b);
      // "newer" = preceding entry in date-descending list; wrap from idx 0 to last
      target = targets[(idx - 1 + targets.length) % targets.length];
    }

    b.article.next = target && target !== b ? toCard(target) : null;
  }
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

function compareArticles(a, b) {
  if (a.datePublished && b.datePublished && a.datePublished !== b.datePublished) {
    return a.datePublished < b.datePublished ? 1 : -1;
  }
  if (a.datePublished && !b.datePublished) return -1;
  if (!a.datePublished && b.datePublished) return 1;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Querying Notion database ${NOTION_ARTICLES_DB_ID}...`);
  const pages = await queryDatabase(NOTION_ARTICLES_DB_ID);
  console.log(`Found ${pages.length} row(s).`);

  const built = [];
  for (const page of pages) {
    const entry = await buildArticle(page);
    if (entry) built.push(entry);
  }

  built.sort((a, b) => compareArticles(a.article, b.article));
  computeNext(built);

  const articles = built.map((b) => b.article);
  const output = {
    $comment: 'GENERATED — do not hand-edit. Re-run notion-sync.js to refresh.',
    articles,
  };

  mkdirSync(dirname(CONFIG.outFile), { recursive: true });
  writeFileSync(CONFIG.outFile, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\nWrote ${articles.length} article(s) to ${CONFIG.outFile}`);
}

main().catch((err) => {
  console.error('notion-sync failed:', err);
  process.exit(1);
});
