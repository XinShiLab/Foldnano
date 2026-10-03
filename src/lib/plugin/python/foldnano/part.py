"""
PartProxy and MutationLog — live mode only (Phase 6).

These classes will allow plugins to mutate the Foldnano model directly via a
mutation-log that is replayed on the main thread inside a history.snapshotTx.
Deferred to Phase 6.
"""


class MutationLog:
    """Ordered log of mutations for replay on the main thread (Phase 6 only)."""

    def __init__(self) -> None:
        raise NotImplementedError("MutationLog is not yet implemented (Phase 6).")


class PartProxy:
    """Proxy for live part mutations (Phase 6 only)."""

    def __init__(self) -> None:
        raise NotImplementedError(
            "PartProxy is not yet available. "
            "Live mode (format='live') will be implemented in Phase 6. "
            "Use format='foldnano_json' to read/write the full Part JSON instead."
        )
