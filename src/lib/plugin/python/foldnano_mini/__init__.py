"""
foldnano_mini — the old name of ``foldnano.edit``, kept so saved scripts and plugins still run.

Every ``foldnano_mini`` module is the same object as its ``foldnano.edit`` module, so classes
compare equal whichever name imported them.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys

from foldnano._deprecation import warn_deprecated

warn_deprecated("foldnano_mini is the old name of foldnano.edit. Import foldnano.edit instead.")


class _AliasFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, name, path=None, target=None):
        if name.startswith("foldnano_mini."):
            return importlib.util.spec_from_loader(name, self)
        return None

    def create_module(self, spec):
        return importlib.import_module("foldnano.edit" + spec.name[len("foldnano_mini") :])

    def exec_module(self, module) -> None:
        pass


sys.meta_path.insert(0, _AliasFinder())
sys.modules[__name__] = importlib.import_module("foldnano.edit")
