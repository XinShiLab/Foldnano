"""
FoldnanoDocumentProxy — live mode only (Phase 6).

This module is a placeholder. Live proxy objects that let plugins mutate the
document in real-time will be implemented in Phase 6 alongside the mutation-log
replay mechanism on the main thread.
"""


class FoldnanoDocumentProxy:
    """Proxy for live document access (Phase 6 only)."""

    def __init__(self) -> None:
        raise NotImplementedError(
            "FoldnanoDocumentProxy is not yet available. "
            "Live mode (format='live') will be implemented in Phase 6. "
            "Use format='cadnano_json' or format='foldnano_json' instead."
        )
