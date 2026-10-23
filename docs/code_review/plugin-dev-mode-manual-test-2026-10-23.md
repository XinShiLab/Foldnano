---
status: snapshot
---

# Plugin dev mode: manual test, 2026-10-23

Manual test of plugin dev mode (`docs/python-plugin-system.md` § Plugin dev mode) in the real app,
against the real Pyodide worker. Run by the maintainer in Chrome on macOS, branch
`feat/plugin_devMode` with the numpy fix below, Pyodide 314.0.7. Automated coverage is
`src/lib/plugin/linkedPlugins.spec.ts`, `pluginScaffold.spec.ts` and
`src/lib/services/fileAccess/fileAccess.spec.ts`; this records what those can't reach (folder
permission prompts, the sandboxed worker, streaming, editors).

**Result: all 30 checks passed.** One bug was found and fixed during the run (check 8), and one
behaviour was accepted as is (check 26).

## Checks

| #     | Area            | Check                                                                                                      | Result |
| ----- | --------------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| 0     | Basics          | New plugin in an empty folder, `print`, oligo count of a design, unlink, link again                        | Pass   |
| 1     | Edit loop       | Edit to a helper module picked up on the next Run, no restart                                              | Pass   |
| 2     | Edit loop       | Renamed module no longer importable (no stale copy)                                                        | Pass   |
| 3     | Edit loop       | New parameter appears in the run dialog; remembered values kept                                            | Pass   |
| 4     | Edit loop       | Renamed plugin updates its row                                                                             | Pass   |
| 5     | Errors          | Traceback and `SyntaxError` name `<folder>/helpers.py`, `<folder>/plugin.py`                               | Pass   |
| 6     | Errors          | `print` lines stream into the Console during a slow run                                                    | Pass   |
| 7     | Dev environment | Stop on an infinite loop ends only the dev worker; an active installed plugin stays active                 | Pass   |
| 8     | Dev environment | Adding `numpy`: review dialog, Cancel runs nothing, Accept rebuilds and imports numpy                      | Pass\* |
| 9     | Dev environment | Removing `numpy`: review again, fresh environment, `import numpy` fails                                    | Pass   |
| 10    | Dev environment | `network` review; stamp `dev (would run as: custom)`; declared host reachable, undeclared host blocked     | Pass   |
| 11    | Dev environment | Restart env gives a fresh worker and leaves the plugin active                                              | Pass   |
| 12    | Two plugins     | Activating a second linked plugin takes over the dev worker                                                | Pass   |
| 13    | Id rules        | Linking an installed id refused; Import zip of a linked id refused                                         | Pass   |
| 14    | Id rules        | Changed `id` in the folder refused with the unlink/link message                                            | Pass   |
| 15    | Access          | Permission asked again after reload; a denied prompt shows the note and asks again                         | Pass   |
| 16    | Access          | A second tab asks separately                                                                               | Pass   |
| 17    | Access          | Moved folder reported as missing; Re-link restores it; Re-link to another plugin's folder refused          | Pass   |
| 18–19 | Dev mode switch | Off mid-run stops and greys out linked plugins; on brings them back; setting survives reload               | Pass   |
| 20    | Dev mode switch | Safari/Firefox: switch disabled with the Chromium explanation                                              | Pass   |
| 21–22 | New plugin      | Existing `plugin.py` and other files kept                                                                  | Pass   |
| 23    | New plugin      | Generated templates run; `foldnano_mini` edit applies with one Undo; `cadnano_json` needs an active region | Pass   |
| 24    | New plugin      | Invalid version or id shown inline, Create disabled                                                        | Pass   |
| 25    | New plugin      | VS Code completes `ctx.` / `part.` from the stubs; `fplugin.json` checked against the schema               | Pass   |
| 26    | New plugin      | Denying write access creates and links nothing                                                             | Pass†  |
| 27–28 | Check           | Valid plugin reported with environment and ignored entries; two independent errors listed together         | Pass   |
| 29    | Zip             | Zip → unlink → Import zip installs and runs the same; zip has no stubs, `pyrightconfig.json` or `.git`     | Pass   |
| 30    | Apply / undo    | `foldnano_mini` recolour applies as one undo step (covered by 23)                                          | Pass   |

\* **Found and fixed:** the second run of any plugin importing numpy failed with "cannot load
module more than once per process", because the run harness deleted every post-init module,
installed packages included. Not specific to dev mode: pyOrigamiBreak and Design Statistics had
the same failure on their second run. Fixed in "fix: numpy plugins failing from their second run" (only modules loaded from `/plugin_run/`
are dropped); re-tested, and pyOrigamiBreak now runs repeatedly.

† Chrome's write prompt offers "Don't allow" / "Allow". After "Don't allow" nothing was created or
linked, but no error was noticed; the operation looked cancelled. Accepted as is.

## Not covered

- Requirements from PyPI (off-distribution packages) and bundled wheels in a linked folder.
- Edge, Brave and Arc (Chromium; expected to match Chrome).
- Windows and Linux file pickers.
