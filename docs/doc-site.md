---
covers:
  - src/lib/docs/**
  - src/lib/server/docsContent.ts
  - src/lib/server/docsRedirects.ts
  - src/lib/components/docs/AiDocLinks.svelte
  - src/lib/components/docs/AskAiMenu.svelte
  - src/lib/components/docs/DocsSearch.svelte
  - src/lib/components/docs/Callout.svelte
  - src/routes/docs/**
  - src/routes/llms.txt/**
  - src/routes/llms-full.txt/**
---

# Doc Site (`/docs`)

The public docs are mdsvex pages in `src/content/<category>/NN-name.md` (categories: `guide`,
`plugin-development`, `contributors`), rendered by `src/routes/docs/[...slug]`. Front matter
`slug` and `order` decide the URL and the sidebar position; the `NN-` file prefix only keeps the
folder sorted and should track `order`. Page prose follows the doc-site style rules in
`CLAUDE.md` (no em dashes, no `"` in image alt text).

The same markdown also feeds three machine-facing outputs: the search index, the `llms*.txt`
files and per-page `.md` files. All of them read pages through `listDocPages` / `findDocPage`
in `src/lib/server/docsContent.ts`, the one place that globs `src/content`.

## Search

`DocsSearch` (header button, `⌘K` / `Ctrl K` / `/`) lazily fetches `/docs/search-index.json`
on first hover or open and builds a client-side MiniSearch index (`DocSearch` in
`src/lib/docs/doc-search.ts`). The server builds the JSON once per process with
`splitDocSections`: one record per `##` / `###` section plus a page intro record.

- **Anchors must match rehype-slug.** `splitDocSections` runs github-slugger over every
  heading (h1 to h6) outside code fences, in order, so duplicate headings get the same `-1`
  suffixes rehype-slug gives them. If you change heading rendering (another rehype plugin,
  headings inside components), recheck that index hrefs still land on rendered ids.
- **Identifiers are one token.** The tokenizer keeps `snake_case` words whole and also
  indexes their parts, so `get_slot_at` matches exactly and `slot` still finds it.
- **Ranking:** heading > page title > body; every query term is required, falling back to any
  term when nothing matches; the category being read gets a mild boost.
- **Navigation waits for the dialog to close** (`onOpenChangeComplete`); navigating while the
  dialog's scroll lock is active drops the jump to the anchor.

## AI-facing text

| URL                          | Content                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| `/llms.txt`                  | Index in the llmstxt.org shape: one line per page linking its `.md`, plus the bundles |
| `/llms-full.txt`             | Every page, site order                                                                |
| `/docs/<category>/llms.txt`  | One category's pages                                                                  |
| `/docs/<category>/<slug>.md` | One page                                                                              |

Near-miss paths (`/docs/llms.txt`, `/llm.txt`, `/docs/llms-full.txt`, `/docs/<category>/llm.txt`,
trailing slashes) 301 to the canonical absolute URL from `hooks.server.ts` via
`llmsTextRedirectPath` (`src/lib/server/docsRedirects.ts`), so old or guessed links keep working.

All of them go through `toAgentMarkdown`: front matter and the mdsvex `<script>` are removed,
`<Callout>` blocks become blockquotes, other component lines are dropped, and site-relative
links become absolute using the request origin. Links are absolute because agents often resolve
relative links against the wrong base; the origin comes from the request, so production,
previews and local dev each describe themselves.

`AskAiMenu` (top right of every page) copies or opens the page's `.md` and starts a ChatGPT or
Claude chat with a prompt pointing at it. `AiDocLinks` shows the full URLs with copy buttons on
the user-facing guide page `src/content/guide/02-ai-assistants.md`.

## Boundaries / Don'ts

- **Don't glob `src/content` in new routes;** add to `docsContent.ts` so every output sees the
  same pages and slugs.
- **Don't put content an agent needs inside a component.** Component lines are dropped from
  the markdown outputs; keep the information in plain markdown next to the component.
- **Don't import `doc-markdown.ts` from client code** without need: it pulls in github-slugger.
  Client code uses `doc-search.ts`.
- New doc text routes go through `hasAlphaAccess` like the existing ones (`routes-guide.md`
  § Access gate).
