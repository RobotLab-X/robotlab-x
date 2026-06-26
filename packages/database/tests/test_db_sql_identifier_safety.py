"""Tests for SQL-injection defenses on identifiers (table/column names).

Two layers of defense:
  1. ``_validate_identifier`` / ``_safe_ident`` raise on bad inputs.
  2. Builders use ``psycopg2.sql.Identifier`` (postgres) or allowlist-quote
     (sqlite) so the SQL text is never f-string-interpolated.

For postgres, we introspect the ``psycopg2.sql.Composable`` tree directly
(walking ``Composed.seq``) so we don't need a live Postgres connection.
The crucial invariant: the table/column name must appear as a separate
``Identifier`` node — never embedded inside a raw ``SQL(...)`` chunk.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile
from typing import Iterable
from unittest.mock import MagicMock

import pytest
from psycopg2 import sql as pgsql

from database.postgres_database import PostgresDatabase
from database.sqlite_database import SqliteDatabase
from models.database_sqlite_config import DatabaseSqliteConfig


# Strings that contain non-identifier characters. Rejected by *both* validators.
# Postgres permits hyphens by design, so pure "user--" isn't flagged at this
# layer — sql.Identifier still safely double-quotes it.
MALICIOUS_IDENTS = [
    'user"; DROP TABLE x; --',
    "user'; DROP TABLE x; --",
    "user OR 1=1",
    "user;",
    "",
]

# Postgres validator additionally caps identifier length at 63 chars.
PG_ONLY_MALICIOUS = MALICIOUS_IDENTS + ["u" * 64]

# sqlite's _safe_ident is stricter — no hyphens, must start with letter/underscore.
SQLITE_ONLY_MALICIOUS = MALICIOUS_IDENTS + [
    "1startswithdigit",
    "with-hyphen",
    "with space",
    "user--",
]


def _walk_identifiers(node: pgsql.Composable) -> Iterable[str]:
    if isinstance(node, pgsql.Identifier):
        for s in node.strings:
            yield s
    elif isinstance(node, pgsql.Composed):
        for child in node.seq:
            yield from _walk_identifiers(child)


def _walk_sql_chunks(node: pgsql.Composable) -> Iterable[str]:
    if isinstance(node, pgsql.SQL):
        yield node.string
    elif isinstance(node, pgsql.Composed):
        for child in node.seq:
            yield from _walk_sql_chunks(child)


# ── Postgres-side ─────────────────────────────────────────────────────────


class _StubPgDb(PostgresDatabase):
    """Bypass __init__ so we can exercise SQL-building helpers without a live db."""
    def __init__(self):
        self.config = None
        self.sslmode = "prefer"
        self._pool = None


class TestPostgresIdentifierValidation:
    def setup_method(self):
        self.db = _StubPgDb()

    @pytest.mark.parametrize("ident", PG_ONLY_MALICIOUS)
    def test_validate_identifier_rejects_malicious(self, ident):
        with pytest.raises(ValueError):
            self.db._validate_identifier(ident, "test")

    def test_validate_identifier_accepts_normal(self):
        self.db._validate_identifier("user", "test")
        self.db._validate_identifier("auth_session", "test")
        self.db._validate_identifier("log_event_42", "test")


class TestPostgresStatementsUseIdentifier:
    def setup_method(self):
        self.db = _StubPgDb()
        self._mock_cur = MagicMock()
        self._mock_cur.fetchone.return_value = None
        self._mock_cur.fetchall.return_value = []

        class _CtxCur:
            def __init__(_, cur): _._cur = cur
            def __enter__(_): return _._cur
            def __exit__(_, *a): return False

        self.db._get_cursor = MagicMock(return_value=_CtxCur(self._mock_cur))

    def _assert_table_is_identifier(self, table: str):
        assert self._mock_cur.execute.called, "cur.execute was never called"
        stmt = self._mock_cur.execute.call_args.args[0]
        assert isinstance(stmt, pgsql.Composable), \
            f"expected sql.Composable, got {type(stmt).__name__}: {stmt!r}"
        idents = list(_walk_identifiers(stmt))
        assert table in idents, (
            f"table {table!r} not found as an Identifier node; got {idents}"
        )
        for chunk in _walk_sql_chunks(stmt):
            assert table not in chunk, (
                f"table name {table!r} leaked into raw SQL chunk {chunk!r}"
            )

    def test_insert_item(self):
        self.db.insert_item("user", "id-1", {"id": "id-1", "email": "a@b"})
        self._assert_table_is_identifier("user")

    def test_upsert_item(self):
        self.db.upsert_item("auth_session", "k", {"id": "k", "status": "active"})
        self._assert_table_is_identifier("auth_session")

    def test_get_item(self):
        self.db.get_item("user", "id-1")
        self._assert_table_is_identifier("user")

    def test_get_all_items(self):
        self.db.get_all_items("user")
        self._assert_table_is_identifier("user")

    def test_delete_item(self):
        self.db.delete_item("user", "id-1")
        self._assert_table_is_identifier("user")

    def test_update_item_table_and_column(self):
        self.db.update_item("user", "id-1", {"email": "b@c"})
        self._assert_table_is_identifier("user")
        stmt = self._mock_cur.execute.call_args.args[0]
        assert "email" in list(_walk_identifiers(stmt))

    def test_search_by_key_part(self):
        self.db.search_by_key_part("user", "abc")
        self._assert_table_is_identifier("user")

    def test_get_binary_item(self):
        self._mock_cur.fetchone.return_value = (b"x",)
        self.db.get_binary_item("user", "id-1")
        self._assert_table_is_identifier("user")

    @pytest.mark.parametrize("ident", PG_ONLY_MALICIOUS)
    def test_helpers_reject_malicious_table_name(self, ident):
        with pytest.raises(ValueError):
            self.db.get_item(ident, "k")


# ── SQLite-side ───────────────────────────────────────────────────────────


class TestSqliteSafeIdent:
    @pytest.mark.parametrize("ident", SQLITE_ONLY_MALICIOUS)
    def test_rejects_malicious(self, ident):
        with pytest.raises(ValueError):
            SqliteDatabase._safe_ident(ident, "test")

    @pytest.mark.parametrize("ident", ["user", "auth_session", "_leading_underscore", "x42"])
    def test_accepts_normal_and_quotes(self, ident):
        out = SqliteDatabase._safe_ident(ident, "test")
        assert out == f'"{ident}"'

    def test_rejects_non_string(self):
        with pytest.raises(ValueError):
            SqliteDatabase._safe_ident(123, "test")


class TestSqliteRoundTripWithSafeIdent:
    def setup_method(self):
        SqliteDatabase._instance = None
        self.tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".db")
        self.tmp.close()
        cfg = DatabaseSqliteConfig(sqlite_path=self.tmp.name)
        self.db = SqliteDatabase(cfg)
        conn = sqlite3.connect(self.tmp.name)
        conn.execute('CREATE TABLE "thing" ("id" TEXT PRIMARY KEY, "name" TEXT)')
        conn.commit()
        conn.close()

    def teardown_method(self):
        SqliteDatabase._instance = None
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass

    def test_insert_and_get_normal(self):
        self.db.upsert_item("thing", "k1", {"id": "k1", "name": "alpha"})
        got = self.db.get_item("thing", "k1")
        assert got["id"] == "k1"
        assert got["name"] == "alpha"

    @pytest.mark.parametrize("bad", SQLITE_ONLY_MALICIOUS)
    def test_malicious_table_rejected(self, bad):
        with pytest.raises(ValueError):
            self.db.get_item(bad, "k1")
        with pytest.raises(ValueError):
            self.db.upsert_item(bad, "k1", {"id": "k1"})
        with pytest.raises(ValueError):
            self.db.delete_item(bad, "k1")
