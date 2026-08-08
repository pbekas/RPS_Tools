"""Application database facade.

Firestore remains the production backend during the RDS migration. Callers import
this module instead of binding directly to Firestore, allowing repository functions
to move to PostgreSQL incrementally without changing business modules again.
"""

from __future__ import annotations

from types import ModuleType
from typing import Any

from src.config import get_settings

_backend: ModuleType | None = None


def backend_name() -> str:
    return get_settings().database_backend


def _load_backend() -> ModuleType:
    global _backend
    if _backend is not None:
        return _backend

    selected = backend_name()
    if selected == "firestore":
        from src import firestore_db

        _backend = firestore_db
        return _backend

    if selected == "postgres":
        from src import postgres_db

        _backend = postgres_db
        return _backend

    raise RuntimeError(f"Unsupported database backend: {selected}")


def reset_backend_for_tests() -> None:
    global _backend
    _backend = None


def __getattr__(name: str) -> Any:
    return getattr(_load_backend(), name)
