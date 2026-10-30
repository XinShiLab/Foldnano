---
title: Agent Runs (Experimental)
description: Let a coding agent such as Claude Code or Codex run Python on your open design through a linked plugin folder, and what that does and does not protect
category: plugin-development
order: 11
slug: agent-runs
covers:
  - src/lib/plugin/agentRuns.ts
  - src/lib/plugin/AgentRunListener.svelte.ts
  - src/lib/plugin/python/agent/run.py
  - src/lib/components/Editor/Plugin/AgentRunIndicator.svelte
  - src/lib/model/io/designOverview.ts
---

<script>
	import Callout from '$lib/components/docs/Callout.svelte';
</script>

# Agent Runs (Experimental)

Agent runs let a coding agent on your computer (Claude Code, Codex, Cursor, Aider, or a plain script) change the design open in Foldnano. The agent writes small Python scripts in a [linked plugin folder](/docs/plugin-development/plugin-dev-mode), and Foldnano runs them on the design for it, the same way it runs a plugin when you click **Run**. You watch every change appear in the editor, and each one is a single **Undo** step.

<Callout type="warning" title="Highly experimental">

How agent runs work, and the files they write, may change or be removed in a later version. Read [Risks that remain](#risks-that-remain) before you connect a design you care about.

</Callout>

## Why not let the agent edit the design file?

You could export a design, let an agent edit the `.json` file, and import it again. Agent runs exist because that is fragile:

- A design file is full of cross-references (oligos to segments, segments to helices, crossovers to both ends). An agent editing the text can break one without noticing, and you only find out when the import fails or the design looks wrong.
- A rewritten file hides what changed. You get a new design, not a list of edits you can check.
- There is no undo, no preview and no way to stop halfway.

With agent runs the agent never edits the design file. It writes Python against Foldnano's plugin API, and Foldnano applies the result.

### What the plugin system adds

- **Edits go through the editor's own operations.** With a [`foldnano_mini`](/docs/plugin-development/foldnano-mini-api) plugin, the recommended setup for agent runs, every change the script makes (connect, break, recolour, add a helix) is recorded as an operation and replayed by the same code the editor uses.
- **Nothing reaches your design unchecked.** A change the editor would refuse fails with an error the agent can read, instead of being applied. A plugin that returns a whole design instead of a list of changes (the `foldnano_json` and `cadnano_json` formats, which suit plugin development better than agent work) has its result validated and rebuilt on a scratch copy first, and Foldnano asks before giving it a design its format can't fully hold. Either way, a bad result is rejected and your design is not touched.
- **Never over your newer edits.** If you change the design while a script runs, its result is thrown away rather than applied over your work, and the agent is told to run it again.
- **A sandbox.** Scripts run in the same sandbox as any plugin: no access to your disk, and network access only to hosts the plugin declares, which you must approve.
- **A record of every run.** Each run leaves a record in `.foldnano/agent/runs/` with the script's hash, its parameters, its output, and whether its result was applied.
- **A view of what it built.** After each run the agent gets a text overview of the design's structure (see [What the agent sees](#what-the-agent-sees-after-each-run)), so it can check its own result instead of guessing.

### What the editor adds

- **Instant feedback.** Each applied run shows up straight away in the strand view and the 3D view.
- **Undo and redo.** Every applied run is exactly one step on the undo stack.
- **Review when you want it.** A run started with `--ask-user-approval` waits for you to **Apply** or **Discard** it in the Plugins panel, with a summary of what it would change.
- **A dry run that really changes nothing.** With `--dry-run`, Foldnano applies the change to a scratch copy of the design, shows the agent the result, and throws it away. Your design and its undo history are not touched.
- **Everything else stays available:** design checks, autosave and backups, saving to GitHub, and the toolbar badge showing which folder is connected to which design and what is running.

## Set it up

You need a Chromium-based browser (Chrome, Edge, Brave, Arc), Python 3.9 or newer, and a coding agent that can run shell commands.

1. **Make a folder for the project** and link it in Plugins → **Dev** (see [Plugin Dev Mode](/docs/plugin-development/plugin-dev-mode)). For design work, create the plugin with format `foldnano_mini` and apply strategy `replayMutationLog`: the agent then works with the design as Python objects, and every change is recorded as an operation. Keeping the folder in git gives you a history of the agent's scripts.
2. **Turn on Agent runs.** Under the **Plugin dev mode** switch, turn on **Agent runs** (marked *Experimental*).
3. **Open the design** the agent should work on, then click **Agent runs** on the folder's bar. Foldnano asks for permission to write to the folder and connects the folder to that design. It adds:
   - `.foldnano/run.py`, the command the agent uses (Python standard library only);
   - `AGENTS.md`, instructions for the agent, and a `CLAUDE.md` that imports it (Claude Code loads both when it starts in the folder). `AGENTS.md` opens with first steps and a map of the folder, so the agent can start from the local API stubs without exploring or searching the web. Foldnano keeps its own `AGENTS.md` up to date each time you connect, until you edit it; after that the file is yours and stays as you left it;
   - the Python API stubs in `.foldnano-stubs/`, so the agent can look up the API offline;
   - an empty `agent-scripts/` folder for the agent's scripts.
4. **Start the agent in that folder**, not in a parent folder or somewhere else. The agent reads `AGENTS.md` from the folder it starts in, and `.foldnano/run.py` only talks to the design connected to its own folder. With Claude Code, for example, open a terminal, `cd` into the folder and run `claude`.

The toolbar now shows a badge such as **Agent runs: my-folder → My design**. Keep the editor tab open while the agent works.

## Working with the agent

Talk to the agent about the design in plain language. Behind the scenes it writes a script in `agent-scripts/`, runs it with `python .foldnano/run.py agent-scripts/<script>.py`, and reads the output. You see each applied change in the editor as it happens.

### Example: removing nicks

> **You:** Find every nick between two staples in the active region. Don't change anything yet; just tell me how many there are and which ones would make a staple longer than 60 nt if joined.
>
> **Agent:** writes `agent-scripts/01-find-nicks.py`, which only reads the design and prints what it finds, and runs it. *"There are 37 nicks. Joining 4 of them would create staples longer than 60 nt (listed below)."*
>
> **You:** Join the other 33, but let me review the result before it is applied.
>
> **Agent:** writes `agent-scripts/02-join-nicks.py`, which joins the 3′ and 5′ ends at each nick with `connect_oligos`, and runs it with `--ask-user-approval`. *"The change is waiting for you to Apply or Discard in Foldnano: 33 staples joined."*
>
> **You:** click **Apply** in the Plugins panel. The agent's command was waiting for your decision and tells it the change is applied, so it does not run the script again. If the result is not what you wanted, **Undo** reverts it in one step.

### More things to ask

- *"Colour all staples shorter than 18 nt red, so I can find them."*
- *"How many crossovers does each helix have? Print a table; don't change anything."*
- *"Break every staple longer than 60 nt near its middle, at a position that is not next to a crossover."*
- *"Run plugin.py and fix whatever error it raises."* (Useful while you develop the plugin itself.)

### Tips

- **Start with `--describe`.** It shows the agent the design's structure before it changes anything, and the agent can use it again at any time.
- **Ask for a read-only look first.** A script that only prints costs nothing and shows whether the agent understood the task.
- **Dry run or review?** `--dry-run` lets the agent check its own work: nothing changes, and it runs the script again without the flag to make the change. `--ask-user-approval` is the real change, held for your decision; say "let me review first" to get it. The agent must not run the script again after you apply it, or the change would be made twice; `AGENTS.md` tells it so.
- **One change per script.** Numbered scripts (`01-…`, `02-…`) are easy to read and to replay in order on a fresh copy of the design.
- **Don't edit the design while a script runs.** Its result would be thrown away (on purpose) and the agent would have to run it again.
- **While a result waits for your review, further runs queue.** The agent's command says it is waiting for you.

## What the agent sees after each run

A coding agent can't see the editor. So after each run, `run.py` prints an overview of the active region as it is now, and the agent reads it like any other output. It looks like this:

```text
[foldnano] design now: region "HONEYCOMB Region 1" (honeycomb), 6 helices, bp 0–83
  helices, number(row,col): 14(1,1)  13(1,0)  16(2,1)  15(2,0)  12(0,1)  17(0,0)
  scaffold: 504 nt, linear, 6 segments, 5 crossovers
    helix order: 14 → 13 → 16 → 15 → 12 → 17
    route 5'→3': 14[0→83]  13[83→0]  16[0→83]  15[83→0]  12[0→83]  17[83→0]
  staples: 28, 14–77 nt (median 42), 3 outside 15–60 nt
    lengths: 10–19:1  20–29:2  30–39:6  40–49:12  50–59:4  60–69:2  70–79:1
    outside 15–60 nt, by 5' end: 13[20] 14 nt  15[61] 77 nt  16[40] 66 nt
```

It lists:

- the region's helices, by number and lattice cell;
- each scaffold's route: the order it visits the helices, its segments from 5′ to 3′, its crossovers, and any stretch with no staple paired to it;
- staple lengths, with the staples outside 15–60 nt (the lengths most suppliers make routinely) named by their 5′ end;
- the other regions, by name and size.

Long lists are cut short, so a large design still fits on about a page.

The overview never includes sequences, oligo names, colours or notes. It does include the structure, and it goes into the agent's conversation after every run (see [Risks that remain](#risks-that-remain)).

- Every finished run ends with it, including scripts that only print.
- After a `--dry-run`, it shows the design as it would be with the change, not the design as it is.
- `python .foldnano/run.py --describe` prints it at any time without running anything. It is a good first step for the agent.
- `--no-overview` leaves it out of a run's output, for example to save the agent's context on a long session. The run record still holds it.

The overview states facts, not advice: Foldnano does not judge whether a route or a staple is good. Helix numbering in scaffold order, crossover placement and staple lengths are design choices, and the overview only makes them visible.

## How it works

There is no server and no network connection between the agent and Foldnano. They talk through files in the linked folder, which both can read and write.

```text
coding agent                     linked folder                       Foldnano tab
------------                     -------------                       ------------
python .foldnano/run.py   ─────▶ .foldnano/agent/requests/<id>.json
                                                                     checks the folder twice a second
                                 .foldnano/agent/runs/<id>.json ◀─── "running"
                                                                     runs the script like a plugin,
                                                                     applies the result (one Undo step)
waits, prints the output  ◀───── .foldnano/agent/runs/<id>.json ◀─── "done" / "error" / ...
                                 .foldnano/agent/listener.json  ◀─── heartbeat every few seconds
```

- **Requests.** `run.py` writes a small request file (which script, its parameters, and whether to apply the result) and waits. Foldnano picks it up, acknowledges it, runs it, and writes the run record. `run.py` prints the script's output (or the Python traceback) and exits with code 0 only if the run succeeded and its change was really applied (by Foldnano, or by you after `--ask-user-approval`; for `--dry-run`, if it would apply). A `--describe` request runs no Python; the editor only answers it with the overview.
- **Scripts.** A script has the same shape as `plugin.py` (a `run(ctx)` function) and runs as the plugin: same format, apply strategy and packages, with the plugin's own modules importable. Only the starting file is swapped for that one run.
- **One folder, one design.** The connection belongs to the design you clicked **Agent runs** on. Only the tab that shows that design and is allowed to edit it listens, and only one tab at a time can listen to a folder. Other designs and tabs are never touched.
- **Heartbeat.** Foldnano rewrites `listener.json` every few seconds, also during a long run. If it stops (the tab closed or crashed), `run.py` reports that no editor is listening instead of waiting forever.
- **Sessions.** Each time a folder starts listening it starts a new session, and a request must carry the current one. Requests that were already waiting before that (left over from earlier, or written while agent runs were off) are rejected and never run.
- **Reloads.** The connection survives a reload of the same design. You may need to click the badge to allow folder access again.

## Risks that remain

<Callout type="warning" title="Your design goes to your AI provider">

Any script the agent runs can read the **whole** design, including every sequence, name and note, and the agent can print it into its conversation. On top of that, the overview of the design's structure (no sequences) goes into the conversation after every run. Unless the agent uses a model that runs on your own computer, that conversation is sent to the company that provides the model. Depending on the provider and your plan, it may be kept in chat history and logs, reviewed by people, or used to train future models. Check your provider's data policy before connecting a design that is confidential or unpublished, or use a local model.

</Callout>

- **Anything that can write to the folder can change the connected design.** While agent runs are on, any program on your computer that writes a request into `.foldnano/agent/requests/` can run Python on the design. Only connect folders and agents you trust, and turn agent runs off when you're done.
- **Results are applied straight away.** Each run is one **Undo** step, but a long session can bury an unwanted change under later ones. Ask for `--ask-user-approval` on changes you want to check.
- **The agent can change the plugin itself.** It can edit `plugin.py` and `fplugin.json`. If it adds packages or network access, Foldnano asks you before running: read that dialog instead of clicking through it.
- **Some routes are outside Foldnano's control.** Turning agent runs off does not stop an agent from reading design files you saved or exported into a folder it can access, a GitHub repository it can read, or a browser it is allowed to control.
- **Run records are a log, not a backup.** They hold hashes of the code that ran and of the design before and after, not the code or the design themselves. Replaying the scripts on the same starting design, with the same plugin files, should give the same result; the records let you check that.

## Turn it off

Any of these ends the connection, in every tab:

- click **×** on the toolbar badge, or **Agent runs on** on the folder's bar;
- turn off the **Agent runs** switch;
- turn off **Plugin dev mode**;
- unlink the folder.

After that, `run.py` reports that no editor is listening, and nothing the agent writes into the folder is run, even after you turn agent runs on again.
