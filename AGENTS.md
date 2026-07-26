# Content Sync via Agents — A Reusable Playbook

A field guide for using an **orchestrator agent + subagents + human approval
gates** to make a website's content **regenerable from a single source of
truth** (a headless CMS such as Notion, Contentful, Sanity, or a spreadsheet),
without changing the site's visual design.

It captures a *way of working*, not a specific project. Adapt the nouns
(framework, CMS, field names) to your stack.

---

## 0. What this produces

- Content lives in **one source** (the CMS). The site is a **regenerable view** of it.
- A **sync script** pulls from the CMS and writes a **checked-in data file**.
- The site's templates render **from that data file** — so re-running the sync,
  restyling, or renaming classes are all independent operations.
- Re-runs are **idempotent**: unchanged source ⇒ byte-identical output.

The north-star sentence: **"The markup is a regenerable view; the data lives in the CMS."**

---

## 1. Principles (the mindset that makes the rest work)

1. **Ground before you plan.** Never design against the plan's description of
   the system — design against the *actual* system. Verify API access, read the
   *real* schema, open the *real* templates, fetch a *real* record. Plans are
   written from memory and are often subtly wrong.
2. **Ask, don't assume.** When the plan and reality diverge, or a decision
   changes the shape of the work, put it to the human as a crisp choice with a
   recommendation. One good question early saves a rewrite later.
3. **Separate data from presentation.** The sync script emits *data* (field
   names, values). Class names and markup live *only* in the templates. This
   decoupling is the single highest-leverage decision — it's why you can rename
   a CSS class and never touch the sync script.
4. **Zero visual change is a claim you must prove**, not assert. Diff the built
   output; don't eyeball it.
5. **Idempotency is a design constraint, not a nice-to-have.** If a second run
   produces a different file, the pipeline isn't trustworthy.
6. **The orchestrator owns the human loop; subagents do bounded work.**
   Subagents can't wait for approval mid-run, so the orchestrator holds every
   approval gate and hands subagents fully-specified, self-verifiable tasks.

---

## 2. The orchestration model

```
Human  ⇄  Orchestrator agent  ⇄  Subagents (cheaper/faster models)
          │
          ├─ owns: understanding, the plan, every approval gate, final review
          └─ delegates: well-specified implementation chunks that can self-verify
```

- **Divide the plan into subtasks**, but only *implement* the ones that are
  cleanly separable and specifiable. Delicate, foundational work (the data
  model, the "zero-visual-change" refactor) is usually best kept by the
  orchestrator; mechanical or well-bounded work (writing a script to a fixed
  output contract) is good to delegate.
- Use a **cheaper model** for subagents when the task is precise and verifiable.
  Keep the orchestrator accountable for correctness — always review subagent
  output and re-verify against reality.
- Don't parallelize subagents across the **same files** — serialize where they'd
  collide (e.g. two agents both editing the sync script or the data file).

---

## 3. Phases (each ends at a human approval gate)

Run these in order. Do not start coding a later phase until the earlier gate is
signed off. This is slower per step and dramatically faster overall.

### Phase 0 — Verify access & read reality
- Confirm you can reach the CMS with the provided credentials (a single read
  call). Report the real schema you find.
- Open the real templates the content will flow into. Fetch one real record and
  one real body/rich-text payload.
- Surface **mismatches between the plan and reality** immediately (e.g. "the
  plan says write raw HTML files, but this project renders pages through a
  framework/build step, so those files are generated artifacts, not the source").

### Phase 1 — Restate & map (gate)
- Restate the schema back in your own words.
- Produce a **mapping table**: `CMS field → template location / attribute / class`.
- State explicitly which data comes from **structured fields** (metadata) vs
  **body/rich-text content** (the block tree).
- List the display rules (empty fields skipped, status-based states, date
  formats) — and note where the plan's wording differs from what's actually in
  the templates (match the templates; flag the difference).
- **Gate:** get confirmation the mapping is correct before touching anything.

### Phase 2 — Normalize the templates (gate)
- **Compulsory first step — compare the source schema against the template
  structure.** Put the source data model (e.g. your CMS/database columns and the
  body block types) side by side with the existing article/page templates and
  check they line up: every source field should have a home in the template, and
  every dynamic part of the template should have a backing field.
  - **If they differ** (fields with no slot in the template, or template pieces
    with no backing field): **propose a normalization** that reconciles them —
    typically adjust the templates (and/or the source schema) so each dynamic
    piece maps 1:1 to a field — and get agreement *before* refactoring.
  - **If the templates don't exist yet** (e.g. there is no blog/section at all):
    **propose creating them** from the schema — scaffold minimal templates whose
    structure matches the data model — before wiring up the sync.
  - Record the reconciled field↔structure mapping; it becomes the contract the
    sync script targets in Phase 3.
- Refactor the templates to render **from the data file** instead of hardcoded
  content, choosing a body representation (see §4).
- Keep names honest: blocks shared across multiple template types should not
  carry a type-specific name.
- **Prove zero visual change** (see §5) and only then commit.
- **Gate:** show the comparison outcome (aligned / normalized / newly created),
  the normalized structure, and the diff.

### Phase 3 — Design the sync script (gate)
- Present: config (env vars), the query, the **field → data-model mapping**, the
  **block-normalization rules**, media handling, computed fields, ordering,
  idempotency guarantees, and dependencies — *before* writing code.
- **Gate:** design approved before implementation.

### Phase 4 — Implement & verify
- Implement (optionally delegate to a subagent with the brief in §7).
- Run it against the live source; run the site build; validate the output
  against the data-model contract; confirm idempotency (run twice, diff = empty).

### Phase 5 — Document & wire automation
- README: how to set env vars, how to run the sync, what it reads and writes.
- Optionally add a single command that pulls, syncs, and commits (keep **git out
  of the sync script itself** — see §6).

---

## 4. Choosing how to store the body content

CMS body content is a **block tree** (paragraphs, headings, quotes, images,
lists, with inline formatting). Three options, in order of preference for a
long-lived site:

- **A. Structured data model + template renderers (recommended).** The sync
  script normalizes blocks into a small semantic model
  (`{kind, text|runs|items|src|caption…}`), with **inline formatting as run
  arrays** (`["plain", {code:"x"}, {em:"y"}]`) rather than HTML strings. The
  templates render that model into markup. Cleanest diffs, scoped styling,
  restylable, no raw-HTML injection (`innerHTML` / `dangerouslySetInnerHTML` /
  `set:html` and equivalents).
- **B. Pre-rendered HTML string** injected into the template. Fastest to build,
  but opaque diffs, bypasses the template engine's scoping, hard to restyle.
- **C. Generated Markdown/MDX** files. Great for pure prose, but fights you the
  moment the layout needs specific wrappers/attributes the CMS blocks can't
  express without custom components or transforms.

Pick **A** unless the body is genuinely just prose.

---

## 5. Proving "zero visual change"

A renderer's whitespace and attribute-escaping legitimately change when you
refactor. So don't line-diff raw output — **normalize, then diff**:

1. Build/render the pages **before** your change; save the target output.
2. Make the change; build/render again.
3. Normalize both: strip HTML comments, ignore hashed asset filenames, collapse
   whitespace between tags, then split into one-tag-per-line and diff.
4. The remaining diff should contain **only your intended changes** (e.g. a
   class rename). Anything else is a regression to investigate.

Note: `&#39;` / `&quot;` vs literal `'` / `"` are **semantically identical** —
browsers render them the same. Don't chase those.

---

## 6. Cross-cutting rules

- **Secrets in env only.** Read credentials from `.env` (git-ignored). Ship a
  `.env.example` with placeholders. Never hardcode a key in a committed script,
  a commit message, or a PR body.
- **No git inside content/sync scripts.** The script's job is to produce files.
  Committing/pushing is a separate, explicitly-invoked step, so a sync can be
  run safely anytime without side effects on version control.
- **Deterministic output.** Stable sort, fixed indentation, trailing newline —
  so idempotency is real and diffs are meaningful.
- **Idempotent side effects.** Downloaded assets get **stable, content-derived
  or id-derived filenames**; skip re-downloading if present; always emit the
  same path for the same source.
- **Pin the API version** of the CMS client to the one you actually verified in
  Phase 0. SDK defaults drift and can silently change query semantics.
- **Include every record the *cards/index* need, even if some don't get their
  own page.** Filter *where each surface consumes the data*, not at the source.

---

## 7. Subagent brief template

Give a subagent everything it needs to succeed *and self-verify*. Fill in:

```
# Task: implement <script path>

Build <what> for <framework> site. Repo root: <path>.

## Hard constraints
- Output MUST match the exact shape of <path to the existing data file> —
  read it first; it is the contract the templates consume. Do not invent fields.
- No git commands. Do not commit — leave changes in the working tree.
- Config from env via <lib>; if missing, print the expected .env and exit non-zero.
- Use <CMS client>, constructed pinned to API version <X> (verified to work).
- Deterministic + idempotent: stable sort, N-space indent, trailing newline;
  running twice yields a byte-identical file.

## Field → data mapping
<the table from Phase 1/3>

## Body block → model mapping
<per block type; inline runs rules; drop/merge rules; computed fields>

## Asset handling
<download target, stable naming, skip-if-exists, fallback on failure>

## Deliverables
1. The script.
2. Run it against live data; run the site build (must pass); print the output
   and confirm it validates against the contract.
3. Report: exact run command, files written, and any judgment calls.
```

Then **review the output yourself** and re-verify against the live source. The
subagent is accountable for the task; the orchestrator is accountable for
correctness.

---

## 8. Anti-patterns & gotchas

- **Designing from the plan's prose** instead of the real schema/templates. The
  plan is a starting hypothesis.
- **Skipping gates to "move fast."** The rework from a wrong mapping costs more
  than the gate.
- **Putting class names or markup in the sync script.** That re-couples data and
  presentation and defeats the whole design (rename a class → rewrite the sync).
- **Asserting "no visual change"** without a normalized diff.
- **Non-deterministic output** (unsorted maps, timestamps) that breaks idempotency.
- **Overwriting good local content with placeholder source content** before the
  CMS is actually populated — decide explicitly whether the source is ready to
  be the source of truth.
- **A blanket find-replace** during a rename that also hits names that should
  stay. Rename the specific tokens; then grep to prove no stragglers *and* that
  the names you meant to keep survived.

---

## 9. One-screen checklist

- [ ] Verified live access; read real schema, templates, one real record.
- [ ] Flagged every plan-vs-reality mismatch to the human.
- [ ] Mapping table approved (fields → markup; metadata vs body).
- [ ] Source schema compared to template structure; differences normalized, or
      templates created from the schema if none exist.
- [ ] Body representation chosen (structured model preferred).
- [ ] Templates render from the data file; shared blocks named neutrally.
- [ ] Zero visual change proven by normalized diff; committed.
- [ ] Sync script design approved (config, mapping, idempotency, deps).
- [ ] Script implemented; secrets in `.env`; no git inside it.
- [ ] Ran against live source; build passes; ran twice → identical (idempotent).
- [ ] README written; automation wired separately from the sync.
