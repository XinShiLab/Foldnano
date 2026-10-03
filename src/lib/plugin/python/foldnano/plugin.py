"""
PluginContext — the primary API surface passed to every plugin's run() function.

The worker instantiates PluginContext with the serialised input data and the
declared plugin format, then calls ``run(ctx)``. After run() returns the worker
reads ``ctx.primary_artifact``, ``ctx.artifacts``, ``ctx.plugin_result``, and
``ctx.logs`` and posts them back to the main thread.

In plain-CPython tests you can construct PluginContext directly::

    ctx = PluginContext(
        format="cadnano_json",
        cadnano_json_in=json.dumps(my_cadnano_dict),
    )
    run(ctx)
    result = json.loads(ctx.primary_artifact)
"""

from __future__ import annotations

import json as _json
from typing import Union

#: Total size of all artifacts from one run. Larger outputs belong in the primary result or a
#: download the plugin splits up; the host refuses to carry more to the page.
MAX_ARTIFACT_BYTES = 100 * 1024 * 1024


def artifact_size(data: Union[str, bytes]) -> int:
    """Bytes an artifact takes once sent to the page (str is sent as UTF-8)."""
    return len(data) if isinstance(data, (bytes, bytearray)) else len(data.encode("utf-8"))


class PluginContext:
    """
    Holds all I/O for a single plugin run.

    Parameters
    ----------
    format:
        ``"cadnano_json"`` | ``"foldnano_json"`` | ``"live"``
    cadnano_json_in:
        Serialised cadnano JSON string; required when format == "cadnano_json".
    foldnano_json_in:
        Serialised Part.toJSON() string; required when format == "foldnano_json"
        or "live".
    """

    def __init__(
        self,
        format: str,
        cadnano_json_in: str | None = None,
        foldnano_json_in: str | None = None,
        params_json: str | None = None,
        side_panel_input_json: str | None = None,
        active_region_id: str | None = None,
    ) -> None:
        if format not in ("cadnano_json", "foldnano_json", "foldnano_mini", "live"):
            raise ValueError(
                f"Unknown plugin format {format!r}. "
                "Expected 'cadnano_json', 'foldnano_json', 'foldnano_mini', or 'live'."
            )
        self._format = format
        self._cadnano_json_in = cadnano_json_in
        self._foldnano_json_in = foldnano_json_in
        self._params: dict = _json.loads(params_json) if params_json else {}
        self._side_panel_input: dict = (
            _json.loads(side_panel_input_json) if side_panel_input_json else {}
        )
        self._active_region_id = active_region_id

        # Outputs — written by the plugin, read by the worker after run().
        self.primary_artifact: str | None = None
        self.artifacts: dict[str, Union[str, bytes]] = {}
        self.plugin_result: dict | None = None
        self.logs: list[str] = []
        # Set by foldnano_mini plugins via set_result_mutation_log().
        self.mutation_log: list[dict] | None = None

    # ------------------------------------------------------------------
    # cadnano_json mode
    # ------------------------------------------------------------------

    def get_part_as_cadnano_json(self, part_index: int = 0) -> str:
        """
        Return the active part as a cadnano JSON string.

        Only valid when the plugin manifest declared ``format = "cadnano_json"``.
        """
        if self._format != "cadnano_json":
            raise RuntimeError(
                f"get_part_as_cadnano_json() called but plugin format is {self._format!r}. "
                "Declare 'format': 'cadnano_json' in the manifest."
            )
        if self._cadnano_json_in is None:
            raise RuntimeError("No cadnano JSON input was provided to this PluginContext.")
        if part_index != 0:
            raise NotImplementedError("Multi-part documents are not yet supported (part_index > 0).")
        return self._cadnano_json_in

    def set_result_cadnano_json(self, json_str: str) -> None:
        """
        Store the plugin's output as a cadnano JSON string.

        The host will apply it to the model using the declared ``applyStrategy``.
        """
        if not isinstance(json_str, str):
            raise TypeError(f"Expected str, got {type(json_str).__name__}")
        self.primary_artifact = json_str

    # ------------------------------------------------------------------
    # foldnano_json mode
    # ------------------------------------------------------------------

    def get_part_as_foldnano_json(self, part_index: int = 0) -> str:
        """
        Return the active part as a Foldnano JSON string (Part.toJSON() format).

        Valid when the plugin manifest declared ``format = "foldnano_json"``,
        ``"foldnano_mini"``, or ``"live"``.
        """
        if self._format not in ("foldnano_json", "foldnano_mini", "live"):
            raise RuntimeError(
                f"get_part_as_foldnano_json() called but plugin format is {self._format!r}. "
                "Declare 'format': 'foldnano_json' or 'foldnano_mini' in the manifest."
            )
        if self._foldnano_json_in is None:
            raise RuntimeError("No Foldnano JSON input was provided to this PluginContext.")
        if part_index != 0:
            raise NotImplementedError("Multi-part documents are not yet supported (part_index > 0).")
        return self._foldnano_json_in

    def set_result_foldnano_json(self, json_str: str) -> None:
        """
        Store the plugin's output as a Foldnano JSON string (Part.toJSON() format).
        """
        if not isinstance(json_str, str):
            raise TypeError(f"Expected str, got {type(json_str).__name__}")
        self.primary_artifact = json_str

    # ------------------------------------------------------------------
    # foldnano_mini mode
    # ------------------------------------------------------------------

    def set_result_mutation_log(self, log: list[dict]) -> None:
        """
        Store a foldnano_mini mutation log to be replayed against the host's
        canonical ``Part`` under one undo step (apply strategy
        ``replayMutationLog`` / ``replayMutationLogInRegion``).

        Only valid when the plugin manifest declared ``format = "foldnano_mini"``.
        Each op must be a JSON-serialisable dict with an ``op`` key.
        """
        if self._format != "foldnano_mini":
            raise RuntimeError(
                f"set_result_mutation_log() called but plugin format is {self._format!r}. "
                "Declare 'format': 'foldnano_mini' in the manifest."
            )
        if not isinstance(log, list):
            raise TypeError(f"Expected list, got {type(log).__name__}")
        for i, op in enumerate(log):
            if not isinstance(op, dict) or "op" not in op:
                raise ValueError(
                    f"Mutation log entry [{i}] is not a dict with an 'op' key: {op!r}"
                )
        self.mutation_log = list(log)

    # ------------------------------------------------------------------
    # General output
    # ------------------------------------------------------------------

    def log(self, msg: str) -> None:
        """Append a message to the plugin's log."""
        entry = str(msg)
        self.logs.append(entry)
        # Also print so output is visible in CPython tests and the worker
        # captures it via stdout redirection.
        print(entry)

    def write_artifact(self, name: str, data: Union[str, bytes]) -> None:
        """
        Store a named artifact (e.g. a CSV report, a PDB file).

        Artifacts are returned to the host alongside the primary result and can
        be downloaded from the plugin output panel.
        """
        if not isinstance(name, str) or not name:
            raise ValueError("Artifact name must be a non-empty string.")
        if not isinstance(data, (str, bytes)):
            raise TypeError(f"Artifact data must be str or bytes, got {type(data).__name__}")
        others = sum(artifact_size(v) for k, v in self.artifacts.items() if k != name)
        if others + artifact_size(data) > MAX_ARTIFACT_BYTES:
            raise ValueError(
                f"Artifact {name!r} would bring this run's artifacts over the "
                f"{MAX_ARTIFACT_BYTES // (1024 * 1024)} MB limit. Write smaller artifacts, or put "
                "large results in the primary result."
            )
        self.artifacts[name] = data

    def set_result(self, data: dict) -> None:
        """
        Store a structured result dict that will be displayed in the plugin output panel.

        Keys and values must be JSON-serialisable.
        """
        if not isinstance(data, dict):
            raise TypeError(f"Expected dict, got {type(data).__name__}")
        self.plugin_result = data

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def format(self) -> str:
        return self._format

    @property
    def params(self) -> dict:
        """All parameter values passed from the UI."""
        return self._params

    def get_param(self, key: str, default=None):
        """Return a single parameter value, or *default* if not set."""
        return self._params.get(key, default)

    @property
    def side_panel_type(self) -> str | None:
        """Type of host-rendered side panel used for this run, if any."""
        value = self._side_panel_input.get("type")
        return value if isinstance(value, str) else None

    def get_side_panel_code(self, default: str = "") -> str:
        """Return the side panel code-editor contents, or *default* if absent."""
        value = self._side_panel_input.get("code")
        return value if isinstance(value, str) else default

    @property
    def active_region_id(self) -> str | None:
        """
        ID of the DesignRegion the host considered "active" when this plugin
        was launched, or ``None``. Region-scoped plugins should respect this:
        scope their reads/writes to VHs whose ``region_id`` matches.
        """
        return self._active_region_id

    def __repr__(self) -> str:
        return (
            f"PluginContext(format={self._format!r}, "
            f"primary_artifact={'<set>' if self.primary_artifact else None}, "
            f"logs={len(self.logs)})"
        )
