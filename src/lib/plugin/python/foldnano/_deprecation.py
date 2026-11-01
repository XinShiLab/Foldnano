"""Host-internal: warnings for deprecated plugin API names (not part of the plugin API)."""

from __future__ import annotations

import warnings


def warn_deprecated(message: str) -> None:
    """Warn about the plugin line that called the deprecated name's code.

    Python repeats a warning once per calling line per module, and each plugin run gets a fresh
    module, so a line warns once per run.
    """
    # Not DeprecationWarning: Python hides it outside __main__, which plugin code never is.
    warnings.warn(message, FutureWarning, stacklevel=3)
