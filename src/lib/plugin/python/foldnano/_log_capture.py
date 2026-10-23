"""Host-internal: stdout/stderr capture for plugin runs (not part of the plugin API).

The worker's harness points ``sys.stdout`` and ``sys.stderr`` at one instance.
``print('a', 'b')`` arrives as separate ``write()`` calls (``'a'``, ``' '``,
``'b'``, ``'\\n'``), so writes are buffered and split on newlines; each log
entry is one printed line. At most ``MAX_LOG_LINES`` lines of at most
``MAX_LOG_LINE_CHARS`` characters are kept, so a runaway print loop can't grow
without bound before the run timeout stops it. A ``sink`` set for a run also
receives each kept line as it completes, so the host can show output before
the run ends.
"""

from __future__ import annotations

from collections.abc import Callable

MAX_LOG_LINES = 5000
MAX_LOG_LINE_CHARS = 10_000


class LogCapture:
    """Collects printed output as a list of non-blank lines."""

    def __init__(self) -> None:
        self._lines: list[str] = []
        self._partial = ""
        self._dropped = 0
        self._sink: Callable[[str], object] | None = None

    def set_sink(self, sink: Callable[[str], object] | None) -> None:
        """Forward each kept line to ``sink`` as well (``None`` stops forwarding)."""
        self._sink = sink

    def write(self, s: str) -> int:
        *complete, self._partial = (self._partial + s).split("\n")
        for line in complete:
            self._append(line)
        # A long line with no newline yet: keep only what can be shown.
        if len(self._partial) > MAX_LOG_LINE_CHARS:
            self._partial = self._partial[: MAX_LOG_LINE_CHARS + 1]
        return len(s)

    def flush(self) -> None:
        pass

    def clear(self) -> None:
        self._lines.clear()
        self._partial = ""
        self._dropped = 0

    def get_lines(self) -> list[str]:
        """Lines so far, including an unterminated last line (``print(..., end='')``)."""
        if self._partial:
            self._append(self._partial)
            self._partial = ""
        if self._dropped:
            return [*self._lines, f"[output truncated: {self._dropped} more lines not shown]"]
        return list(self._lines)

    def _append(self, line: str) -> None:
        if not line.strip():
            return
        if len(self._lines) >= MAX_LOG_LINES:
            self._dropped += 1
            return
        if len(line) > MAX_LOG_LINE_CHARS:
            line = f"{line[:MAX_LOG_LINE_CHARS]}… [line truncated]"
        self._lines.append(line)
        if self._sink is not None:
            self._sink(line)
