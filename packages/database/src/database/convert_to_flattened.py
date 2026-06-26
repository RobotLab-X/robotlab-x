import sqlite3
import json
import sys
from .record_transformer import RecordTransformer
from .sqlite_database import SqliteDatabase


def migrate_table_to_flattened(sqlite_path, table_name, json_col='json', id_col='id'):
    # Validate + quote every identifier exactly once up front. sqlite3 has no
    # parameterized-identifier API; allowlist-then-quote is the safe pattern.
    t = SqliteDatabase._safe_ident(table_name, "table name")
    jc = SqliteDatabase._safe_ident(json_col, "json column")
    ic = SqliteDatabase._safe_ident(id_col, "id column")

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    transformer = RecordTransformer()

    # 1. Read all rows
    cur.execute(f"SELECT {ic}, {jc} FROM {t}")
    rows = cur.fetchall()

    # 2. Collect all first-level keys
    all_keys = set()
    parsed_rows = []
    for row in rows:
        obj = json.loads(row[json_col])
        flat = transformer.flatten(obj)
        parsed_rows.append((row[id_col], flat))
        all_keys.update(flat.keys())
    all_keys.discard(id_col)  # id is already a column

    # 3. Add missing columns (each key validated as an identifier before use)
    cur.execute(f"PRAGMA table_info({t})")
    existing_cols = {r[1] for r in cur.fetchall()}
    for key in all_keys:
        if key not in existing_cols:
            kc = SqliteDatabase._safe_ident(key, f"column {key!r}")
            cur.execute(f"ALTER TABLE {t} ADD COLUMN {kc} TEXT")
    conn.commit()

    # 4. Update each row with flattened fields
    for row_id, flat in parsed_rows:
        update_keys = [k for k in flat.keys() if k != id_col]
        set_clause = ', '.join(
            f"{SqliteDatabase._safe_ident(k, f'column {k!r}')}=?"
            for k in update_keys
        )
        values = [flat[k] if isinstance(flat[k], str) else json.dumps(flat[k]) for k in update_keys]
        if set_clause:
            cur.execute(f"UPDATE {t} SET {set_clause} WHERE {ic}=?", values + [row_id])
    conn.commit()

    print(f"Migration complete. Table '{table_name}' is now flattened.")
    print(f"You may now drop the '{json_col}' column if desired.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python convert_to_flattened.py <sqlite_path> <table_name> [json_col] [id_col]")
        sys.exit(1)
    sqlite_path = sys.argv[1]
    table_name = sys.argv[2]
    json_col = sys.argv[3] if len(sys.argv) > 3 else 'json'
    id_col = sys.argv[4] if len(sys.argv) > 4 else 'id'
    migrate_table_to_flattened(sqlite_path, table_name, json_col, id_col)
