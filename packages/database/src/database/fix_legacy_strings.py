import sqlite3
import json
import sys
from record_transformer import RecordTransformer
from sqlite_database import SqliteDatabase

def infer_type(val):
    # Try to convert to int, float, bool, None, or JSON
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    if not isinstance(val, str):
        return val
    v = val.strip()
    if v == "":
        return v
    # Try bool
    if v.lower() == "true":
        return True
    if v.lower() == "false":
        return False
    # Try None/null
    if v.lower() in ("none", "null"):
        return None
    # Try int
    try:
        if v.isdigit() or (v[0] == '-' and v[1:].isdigit()):
            return int(v)
    except Exception:
        pass
    # Try float
    try:
        if "." in v or "e" in v.lower():
            return float(v)
    except Exception:
        pass
    # Try JSON
    try:
        parsed = json.loads(v)
        return parsed
    except Exception:
        pass
    return val

def fix_legacy_table(sqlite_path, table_name, id_col='id'):
    # Validate + quote identifiers exactly once. sqlite3 has no parameterized-identifier API.
    t = SqliteDatabase._safe_ident(table_name, "table name")
    ic = SqliteDatabase._safe_ident(id_col, "id column")

    conn = sqlite3.connect(sqlite_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    transformer = RecordTransformer()

    # Get columns
    cur.execute(f"PRAGMA table_info({t})")
    columns = [row[1] for row in cur.fetchall()]
    columns_no_id = [c for c in columns if c != id_col]

    # Read all rows
    cur.execute(f"SELECT * FROM {t}")
    rows = cur.fetchall()

    for row in rows:
        row_dict = dict(row)
        fixed = {k: infer_type(row_dict[k]) for k in columns_no_id}
        fixed[id_col] = row_dict[id_col]
        flat = transformer.flatten(fixed)
        update_keys = [k for k in flat.keys() if k != id_col]
        set_clause = ', '.join(
            f"{SqliteDatabase._safe_ident(k, f'column {k!r}')}=?"
            for k in update_keys
        )
        values = [flat[k] for k in update_keys]
        if set_clause:
            cur.execute(f"UPDATE {t} SET {set_clause} WHERE {ic}=?", values + [row_dict[id_col]])
    conn.commit()
    print(f"Legacy data in table '{table_name}' has been fixed with type info.")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python fix_legacy_strings.py <sqlite_path> <table_name> [id_col]")
        sys.exit(1)
    sqlite_path = sys.argv[1]
    table_name = sys.argv[2]
    id_col = sys.argv[3] if len(sys.argv) > 3 else 'id'
    fix_legacy_table(sqlite_path, table_name, id_col)
