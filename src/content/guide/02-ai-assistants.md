---
title: Using The Docs With AI
description: Give ChatGPT, Claude, or a coding agent the Foldnano docs and ask it questions
category: guide
order: 2
slug: ai-assistants
---

<script>
	import AiDocLinks from '$lib/components/docs/AiDocLinks.svelte';
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Using The Docs With AI

You can ask an AI assistant about Foldnano instead of reading every page yourself. The docs are also published as plain text files written for AI models, so a chatbot or coding agent can read the whole site and answer from it. This works with ChatGPT, Claude, Gemini, and coding agents such as Claude Code, Cursor, or Copilot.

## Links To Give Your Assistant

<AiDocLinks />

| File | What it contains | Use it when |
| --- | --- | --- |
| [/llms.txt](/llms.txt) | A short index: every page with a one-line summary and a link to its markdown | Your assistant can open links (most agents, and chats with web browsing turned on). It reads the index, then opens only the pages it needs. |
| [/llms-full.txt](/llms-full.txt) | Every page of the docs in one file | Your assistant cannot browse, or you want it to know everything up front. Download the file and attach it to the chat. |
| [/docs/guide/llms.txt](/docs/guide/llms.txt) | Only the user guide | You only use the editor and don't need the plugin or contributor docs. |

The plugin docs and contributor docs have their own files too: [/docs/plugin-development/llms.txt](/docs/plugin-development/llms.txt) and [/docs/contributors/llms.txt](/docs/contributors/llms.txt).

## Ask About One Page

Every docs page has an **Ask AI** menu in its top right corner:

- **Copy page as Markdown** copies the page as plain text, ready to paste into any chat.
- **View as Markdown** opens the same text in a new tab. Every page has one: add `.md` to the end of the page address.
- **Open in ChatGPT** and **Open in Claude** start a new chat that already points at the page.

## Search The Docs

To find a page yourself, use **Search docs** in the header, or press `Ctrl K` (`⌘ K` on a Mac) or `/`. Results jump straight to the matching section, and pages from the part of the docs you are reading rank higher.

## Questions To Try

- "How do I export my design for an oxDNA simulation?"
- "What is the difference between a lattice region and a freeform region?"
- "Why can't I add a crossover between these two helices?"
- "Write a Script Lab script that lists every staple longer than 60 nucleotides."
- "I'm used to cadnano. What works differently in Foldnano?"

Coding agents are especially useful for plugins: point one at [/docs/plugin-development/llms.txt](/docs/plugin-development/llms.txt) and ask it to draft a plugin for you.

<Callout type="warning" title="Check the answer against the docs">

AI assistants can still get details wrong, such as a menu name, a keyboard shortcut, or a `foldnano_mini` method that does not exist. Ask the assistant which page it used, then open that page to confirm. The text files always match the current version of these docs, but an assistant may also mix in older knowledge from its training.

</Callout>

<Callout type="tip" title="If the assistant can't open the link">

Some chat apps cannot fetch web pages, or they cut long pages short. Download [/llms-full.txt](/llms-full.txt) (or one of the smaller files) and attach it to the chat as a file instead.

</Callout>
