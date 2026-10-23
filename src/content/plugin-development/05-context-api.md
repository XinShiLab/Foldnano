---
title: Context API Reference
description: Every name on PluginContext, the ctx argument of run(ctx), with what it reads or stores
category: plugin-development
order: 5
slug: context-api
covers:
  - src/lib/plugin/python/foldnano/plugin.py
---

# Context API Reference

Every plugin's `run(ctx)` receives one `PluginContext`. It is the plugin's only connection to the host: it hands in the design, the parameters and the side-panel state, and it takes back the result, the log and any downloads. It never changes the design itself; the host applies the result afterwards, using the manifest's apply strategy (see [Formats and Apply Strategies](/docs/plugin-development/plugin-formats)).

To read the design as objects instead of a JSON string, pass `ctx.get_part_as_foldnano_json()` to the [Parse API](/docs/plugin-development/plugin-api) or to [foldnano_mini](/docs/plugin-development/foldnano-mini-api).

**Kind** says what each name does:

- **read-only**: a property you read; assigning to it is an error.
- **query**: a method that only reads.
- **output**: a method that stores something for the host to pick up after `run()` returns. Calling it again replaces what an earlier call stored (`log` and `write_artifact` add to it instead).
- **constant**, **class**: module-level names.

## Module

| API | Kind | Behaviour |
| --- | --- | --- |
| `PluginContext` | class | The type of `ctx`, imported with `from foldnano.plugin import PluginContext` (or `from foldnano import PluginContext`). The host builds it; you construct one yourself only in tests ([below](#in-tests)). |
| `MAX_ARTIFACT_BYTES` | constant | The most all of one run's artifacts may add up to: 100 MB (text counts as UTF-8). In `foldnano.plugin`. |

## Input

| API | Kind | Behaviour |
| --- | --- | --- |
| `ctx.format` | read‑only | The manifest's `format`: `'cadnano_json'`, `'foldnano_json'` or `'foldnano_mini'`. |
| `ctx.get_part_as_cadnano_json(part_index=0)` | query | The active part as a cadnano JSON string. Only for `format: "cadnano_json"`; any other format raises `RuntimeError`. |
| `ctx.get_part_as_foldnano_json(part_index=0)` | query | The active part as a Foldnano JSON string (the `Part.toJSON()` shape). For `foldnano_json` and `foldnano_mini`; `cadnano_json` raises `RuntimeError`. |
| `ctx.active_region_id` | read‑only | The id of the region that was active in the strand view when the plugin started, or `None`. Region-scoped plugins pass it to `parse_foldnano_json` or `load_part`. |
| `ctx.params` | read‑only | Every parameter value confirmed in the run dialog, keyed by the `id`s in the manifest's `parameters`. |
| `ctx.get_param(key, default=None)` | query | One parameter value, or `default` if it isn't set. |
| `ctx.side_panel_type` | read‑only | `'form'` or `'codeEditor'` when the run started from a side panel, else `None`. |
| `ctx.get_side_panel_code(default="")` | query | The code-editor side panel's contents, or `default` when there is none. |

Documents hold one part, so `part_index` must be 0; any other value raises `NotImplementedError`.

## Output

| API | Kind | Behaviour |
| --- | --- | --- |
| `ctx.set_result_cadnano_json(json_str)` | output | The changed design as a cadnano JSON string: the result the apply strategy applies. |
| `ctx.set_result_foldnano_json(json_str)` | output | The changed design as a Foldnano JSON string, for `foldnano_json` plugins. |
| `ctx.set_result_mutation_log(log)` | output | A `foldnano_mini` mutation log (normally `part.mutation_log`), replayed onto the design as one undo step. Only for `format: "foldnano_mini"`; each entry must be a dict with an `op` key. |
| `ctx.set_result(data)` | output | A JSON-serialisable dict shown in the plugin output panel. It doesn't change the design. |
| `ctx.write_artifact(name, data)` | output | A named download (a CSV, a PDB file, ...) of text or bytes, listed in the plugin output panel. Writing the same name again replaces it. Raises `ValueError` when the run's artifacts would pass `MAX_ARTIFACT_BYTES`. |
| `ctx.log(msg)` | output | Add a line to the plugin log, shown when the run finishes. `print()` output is captured too, one log line per printed line. The log keeps the first 5,000 lines, each up to 10,000 characters. |

Only the `set_result_*` methods produce something the host can apply. `set_result`, `write_artifact` and `log` are for reading and downloading. `ctx.set_artifact` doesn't exist; use `write_artifact`.

## In tests

Outside the browser you build the context yourself and read back what the plugin stored. See [Testing Plugins](/docs/plugin-development/plugin-testing).

| API | Kind | Behaviour |
| --- | --- | --- |
| `PluginContext(format, cadnano_json_in=None, foldnano_json_in=None, params_json=None, side_panel_input_json=None, active_region_id=None)` | class | A context with the given inputs. Pass the design as a JSON string to the `*_in` argument matching `format`, and parameters and side-panel state as JSON strings. |
| `ctx.primary_artifact` | read‑only | The string from `set_result_cadnano_json` / `set_result_foldnano_json`, or `None`. |
| `ctx.mutation_log` | read‑only | The list from `set_result_mutation_log`, or `None`. |
| `ctx.plugin_result` | read‑only | The dict from `set_result`, or `None`. |
| `ctx.artifacts` | read‑only | The artifacts from `write_artifact`, by name. |
| `ctx.logs` | read‑only | The lines from `ctx.log`, in order. |
