"""
foldnano_mini.checks — results of the ``can_*`` predicates.

A :class:`Check` is truthy when the operation is allowed, so a script can
write ``if part.can_create_segment(vh, 10, 30): ...`` and still print
``check.reason`` when it is not. The mutating calls run the same check and
raise :class:`InvalidOperationError` with that reason before recording any op.

The checks are a prediction of what the host accepts on replay; the host stays
authoritative.
"""

from __future__ import annotations


class InvalidOperationError(ValueError):
    """An edit the model refuses (occupied range, out of bounds, ...).

    Named after the host's ``InvalidOperationError``. Subclasses ``ValueError``
    so existing ``except ValueError`` handlers keep working.
    """


class Check:
    """``ok`` plus the ``reason`` it is not, like the host's ``DuplicateCheck``."""

    __slots__ = ("ok", "reason")

    def __init__(self, ok: bool, reason: str | None = None) -> None:
        self.ok = ok
        self.reason = reason

    @classmethod
    def passed(cls) -> "Check":
        return cls(True)

    @classmethod
    def failed(cls, reason: str) -> "Check":
        return cls(False, reason)

    def __bool__(self) -> bool:
        return self.ok

    def raise_if_failed(self) -> None:
        """Raise :class:`InvalidOperationError` with ``reason`` unless ``ok``."""
        if not self.ok:
            raise InvalidOperationError(self.reason)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, bool):
            return self.ok is other
        if isinstance(other, Check):
            return (self.ok, self.reason) == (other.ok, other.reason)
        return NotImplemented

    def __hash__(self) -> int:
        return hash((self.ok, self.reason))

    def __repr__(self) -> str:
        return "Check(ok=True)" if self.ok else f"Check(ok=False, reason={self.reason!r})"
