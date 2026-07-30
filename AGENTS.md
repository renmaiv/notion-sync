**Workspace:** `<your Notion database/view URL>`
**API Key:** `<set NOTION_API_KEY in .env — never commit the real key>`

This plan adapts to **an existing blog of any design** — it maps Notion onto
*your* routes, templates, and class names rather than imposing a fixed layout.
Where a route, element, or CSS token is named below, treat it as a **role to
fill from your own markup**, not a literal to copy (e.g. "the card's width token"
means whatever custom property / attribute your cards already use). `digest` and
`timeline` are used throughout only as example **article types**; substitute your
blog's own types.

---

## Core constraints (all agents)

- **HTML is a regenerable view; the data lives in Notion** (for blog-related tasks).
  Nothing dynamic should exist only in HTML — it must be reproducible from Notion
  properties + page blocks.
- **No git commands inside the content/sync scripts.** Producing files and
  committing them are separate, explicitly-invoked steps.
- **Ground before you code.** Design against the *real* system, not the plan's
  description of it: verify you can reach Notion with the credentials (one read
  call), read the *real* schema, open the *real* templates, and fetch one *real*
  row + one *real* page block tree. Surface any plan-vs-reality mismatch (e.g.
  "the plan says write `index.html`, but pages render through a build step, so
  those files are generated artifacts") *before* designing.
- **Adapt to the existing design; don't impose one.** Discover the blog's routes,
  templates, and class names and map Notion onto them. Never rename or restyle
  the site to fit the plan.
- **Data ⇄ presentation are separate.** The sync script emits **data**; class
  names and markup live **only** in the templates. Renaming a class must never
  require editing a script.
- **Approval gates are mandatory** — restate → get confirmation → only then code.
- **Prove "no visual change", don't assert it.** Build before/after and diff
  *normalized* output (strip comments, ignore hashed asset names, collapse
  inter-tag whitespace); the remaining diff must be only your intended change.
  (`&#39;`/`&quot;` render identically to `'`/`"` — ignore those.)
- **Idempotent + deterministic:** rerunning against unchanged Notion yields a
  byte-identical file (stable sort, fixed indent, trailing newline); downloaded
  assets get stable id-/content-derived names and are skipped if already present.
- **Secrets in `.env` only** (git-ignored) with a committed `.env.example`
  placeholder. **Pin the Notion API version** you verified while grounding — SDK
  defaults drift and can silently change query semantics.
- **Orchestrator vs subagents.** One orchestrator owns understanding, every gate,
  and final review; delegate well-specified, self-verifiable chunks to cheaper
  subagents and re-verify their output. Don't parallelize agents over the same
  files (e.g. two agents both editing the sync script or data file).

---

## Agent 1 — Notion → blog articles & index pages (all article types)

**Important:** You will design the Notion schema yourself.

Your job is to:

- Read your Notion schema,
- Explain back how I understand it,
- Explain exactly how I will map it to the blog's existing HTML/CSS and normalise it,
- Only then start coding.

### Content source:

- The **article body content does not live in a `Content` property**.
- For each row in the **Articles** database, the article body is the **main Notion page content (block tree)** related to that database entry.
- I must:
    - use database properties only for metadata (Title, Slug, Type, Status, Published Date, Image Path, etc.),
    - fetch the page's blocks via the Notion API and map those blocks to the article body markup (recursing into nested / synced / reused blocks).

### Goal:
Use Notion API (free tier) as the single source of truth for the blog's content, and generate/refresh the article and index pages **in the blog's existing design**, without changing visuals.

### Tasks:

#### 1. Understand & restate your Notion schema
- **Input:** Notion database URL + API key (from `.env`, see above).
- **Output:** Show a table-like mapping:
  ```
  Notion property → template location / attribute / class (in the blog's own markup)
  ```
  Explicitly state:
    - metadata (title, slug, type, status, dates, image path, etc.) comes from database properties,
    - article body comes from the **page's content blocks**, which I fetch via the Notion API.
    - **Subtitle handling:** if no subtitle property, skip it entirely (just title and date).
    - Where the plan's wording differs from what's actually in the templates, **match the templates** and flag the difference.
- **Approval gate:** Wait for confirmation that I understood the schema correctly before touching HTML/CSS or code.

#### 2. Locate the blog, then normalise around the schema
- **Compulsory first step — find the blog and compare its structure to the Notion schema.** Locate the existing article templates and index page(s), and lay the properties + body block types next to them: every property should have a home, and every dynamic template piece should have a backing field.
    - **If they line up** → proceed to normalisation.
    - **If they differ** (fields with no slot, or template pieces with no backing field) → propose a **normalisation** so each dynamic piece maps 1:1 to a field (adjust the blog's templates and/or the schema); agree before refactoring.
    - **If no blog/templates exist yet** → do **not** assume a design. Ask the author which starting point they want, and confirm before building:
        1. **scaffold minimal templates from the Notion schema** (a neutral, unopinionated starter), or
        2. **adopt the author's ready-made Astro article components** (the digest/timeline + card/index component set) and map the schema onto them,
        3. or point me at another existing design/template set to target.
- Based on the agreed mapping:
    - **render each page from a checked-in data file** (the data/presentation split) so every dynamic piece is regenerated from Notion — preferred over marking regions in static HTML; where you must manage HTML in place, use stable selectors or minimal `data-*` attributes,
    - ensure every dynamic piece (title, subtitle, date, slug, image path, body, etc.) can be fully regenerated from Notion properties + page blocks,
    - give blocks **shared across article types** neutral names (not type-specific ones).
- **Show:** the proposed normalised version, plus where each Notion field will land.
- **Approval gate:** After approval, update the templates. **Prove no visual change with a normalised diff** before committing.

#### 3. Script design (Node.js preferred)
- Design a script that:
    - reads config from env vars (`NOTION_API_KEY`, database ID(s), output paths); if no config, tell how it should look / create one,
    - **pins the Notion API version** verified while grounding,
    - queries Notion for all "Published" articles,
    - for each article:
        - converts properties + page blocks into the article's **data** (which the matching template renders) — not raw HTML strings hand-assembled in the script,
        - based on a `type` property, picks the matching article template (e.g. digest vs timeline),
        - converts the used Notion **block types from the page content** to the body model (see **Body representation** below),
        - **downloads body images** into a per-article location with stable names (skip if present; fall back to a pasted relative path if download fails),
        - **applies the blog's metadata display rules**, for example:
          - **Subtitle:** if empty, skip rendering it (show only title and date),
          - **draft/WIP status + no date:** render the blog's "in progress" indicator (icon + label) instead of a date,
          - **ever-updating status + no date:** render the blog's "ever-updating" indicator, omit the published date,
    - updates the index page(s):
        - inserts/updates items based on a unique key (slug or page ID),
        - matches the existing design,
    - writes **deterministic** output (stable sort, fixed indent, trailing newline).
- **Present:** this design (steps, file locations, dependencies, API version) for approval before implementing.

#### 4. Implement & ensure idempotency
- Implement the script according to the approved design (optionally delegate to a subagent — see the brief below — and review its output yourself).
- Ensure:
    - reruns do not create duplicates,
    - modified Notion content (properties or page blocks) is correctly updated,
    - the site can be fully regenerated from Notion (no extra "hidden" template-only data),
    - running twice yields an identical file.
- Do not touch visual design. No git commands in the script.

#### 5. Document usage
- Add a short README section explaining:
    - how to set env vars (`.env` / `.env.example`),
    - how to run the script,
    - which files it reads and writes.

### Body representation
- **A — structured model + template renderers (recommended).** Normalise blocks to a small semantic model (`{kind, text|runs|items|src|caption…}`), with inline formatting as **run arrays** (`["plain", {code:"x"}, {em:"y"}]`). Cleanest diffs, scoped styling, restylable, no raw-HTML injection (`innerHTML` / `dangerouslySetInnerHTML` / a template set-HTML directive).
- **B — pre-rendered HTML string.** Fast, but opaque diffs and bypasses the template engine's scoping.
- **C — generated Markdown/MDX.** Great for pure prose; fights you the moment the layout needs specific wrappers/attributes the blocks can't express.

---

## Agent 2 — Auto "Next" article section (same script as Agent 3)

**Goal:** Use the same Notion schema and script from Agent 3 to automatically populate the blog's "Next" section on article pages.

### Tasks:

#### 1. Confirm understanding of ordering
- Based on your schema:
    - explain how I will interpret `Type`, `Published Date`, and `Status` to find the "next" article:
        - same `Type`,
        - `Status = Published`,
        - ordered by `Published Date`,
        - "next" = the next newer one.
    - Describe behaviour when:
        - there is no next article (e.g. newest one),
        - dates are missing or the article has a draft / ever-updating status.
    - Support an explicit **override property** if the schema has one (an author-chosen "next" wins over the computed one).
- **Approval gate:** Wait for confirmation.

#### 2. Map Notion fields → the "Next" section
- Using your schema, list which Notion fields fill the section: title, subtitle, date, image path, slug/URL.
- Show how these map into the blog's existing "Next" markup (its wrappers, image container, and classes — whatever they are).

#### 3. Normalise the "Next" section
- Inspect the blog's current "Next" section in at least one article of each type.
- Make it regenerable from data: the script computes each article's "next" and emits it as **data** on the article record; the template renders it.
- Keep any **static** part of the section (e.g. a standing tagline/link that is part of the design) separate from the computed next-article card, and give each an honest, non-type-specific name.
- Propose any minimal changes if needed, ensuring no visual change.

#### 4. Extend Agent 2 
- In the Notion, after generating each article:
    - compute that article's "next" using the agreed logic,
    - add it to that article's data,
    - let the template render it.
- Ensure reruns update "Next" correctly with no manual edits.

---

## Agent 3 — Blog index cards from Notion

**Goal:** Generate and update the article cards on the blog's index page from your Notion schema — including whatever sizing the design uses (width, aspect ratio) — without changing their current design.

### Tasks:

#### 1. Understand & restate card-related properties
- **Input:** Which Notion properties control index cards (e.g. `Slug`, `Title`, `Subtitle`, `Image Path`, `Card Width`, `Card Aspect Ratio`, `Published Date`, `Status`, `Show on index`).
- **Output:**
    - restate each property's meaning,
    - show the mapping `property → attribute / text / style` **in the blog's own card markup**, for example:
        - a width property → the card's width token (whatever custom property / attribute the design uses),
        - an aspect-ratio property → the card's aspect-ratio token,
        - image path → the card's image element, etc.
    - **Handle metadata display** using the blog's own patterns:
      - **Subtitle:** if empty, skip rendering it,
      - **draft/WIP + no date:** show the blog's "in progress" indicator,
      - **ever-updating + no date:** show the blog's "ever-updating" indicator (no published date).
- **Approval gate:** Wait for confirmation before touching the index page.

#### 2. Normalise the index's managed region
- Inspect the blog's current card markup.
- Define a clearly delimited region the script **owns** (e.g. between comments or inside a wrapper) — or, with the data/presentation split, render the cards from the same data file.
- Ensure every dynamic piece in those cards (title, subtitle, meta text, image, sizing) can be regenerated purely from Notion fields, and that you **include every record the cards need**, even if some don't get their own page (filter where each surface consumes the data, not at the source).

#### 3. Add to sync script:
    - reads env-configured Notion API key and database ID (pinned API version),
    - fetches all pages where the "show on index" flag is true,
    - builds each card **in the blog's existing structure**: the card element with its sizing tokens, the media element with its aspect-ratio token, the image, the title, the subtitle, and a status-aware meta section (published date, or the blog's draft / ever-updating indicators),
    - replaces/updates only the managed region (or the card data file).
- **Present:** this design for approval before implementing.

#### 4. Implement & ordering
- Order cards primarily by `Published Date` (newest first); define and apply a clear rule for undated/draft items (e.g. always at the end, sorted by creation order or page ID).
- Ensure reruns don't create duplicates and update cards when Notion data changes.

#### 5. Constraints
- Keep the blog's existing structure, classes, custom properties, and cropping behaviour.
- No visual changes.
- No git commands inside this script.

---

## Subagent brief template

When delegating a script to a subagent, give it everything to succeed *and self-verify*:

```
# Task: implement <script path>

Build <what> for <repo root>.

## Hard constraints
- Output MUST match the exact shape of <existing data file> — read it first; it
  is the contract the templates consume. Do not invent fields.
- No git commands. Do not commit — leave changes in the working tree.
- Config from env via <lib>; if missing, print the expected .env and exit non-zero.
- Use the Notion client pinned to API version <X> (verified while grounding).
- Deterministic + idempotent: stable sort, N-space indent, trailing newline;
  running twice yields a byte-identical file.

## Property → data mapping     <the approved table, in the blog's own markup>
## Block → body-model mapping   <per block type; run rules; drop/merge; computed fields, e.g. read time>
## Asset handling               <download target, stable naming, skip-if-exists, fallback>

## Deliverables
1. The script.
2. Run it against live Notion; run the build (must pass); print the output and
   confirm it validates against the contract.
3. Report: exact run command, files written, and any judgment calls.
```

Then **review the output yourself** and re-verify against live Notion. The
subagent is accountable for the task; the orchestrator, for correctness.

---

## Next Steps

1. **Confirm Notion workspace access** with the provided credentials (from `.env`).
2. **Point me at the blog** (or confirm there isn't one yet): the index page and one
   example article template per type — or tell me to scaffold from the schema /
   use the provided Astro components.
3. **Provide:** the Articles database schema (property names, types).
4. **I will:** Ground → map & restate; you approve; then I implement, one gate at a time.

---

