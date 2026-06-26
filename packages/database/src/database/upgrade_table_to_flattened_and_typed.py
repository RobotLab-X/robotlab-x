import sys
import subprocess
import os

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python upgrade_table_to_flattened_and_typed.py <sqlite_path> <table_name> [json_col] [id_col]")
        sys.exit(1)
    sqlite_path = sys.argv[1]
    table_name = sys.argv[2]
    json_col = sys.argv[3] if len(sys.argv) > 3 else 'json'
    id_col = sys.argv[4] if len(sys.argv) > 4 else 'id'

    script_dir = os.path.dirname(os.path.abspath(__file__))
    convert_script = os.path.join(script_dir, 'convert_to_flattened.py')
    fix_script = os.path.join(script_dir, 'fix_legacy_strings.py')

    # Step 1: Flatten the table
    print(f"[1/2] Running convert_to_flattened.py on {table_name}...")
    subprocess.run([
        sys.executable, convert_script, sqlite_path, table_name, json_col, id_col
    ], check=True)

    # Step 2: Fix legacy strings to add type info
    print(f"[2/2] Running fix_legacy_strings.py on {table_name}...")
    subprocess.run([
        sys.executable, fix_script, sqlite_path, table_name, id_col
    ], check=True)

    print("Upgrade complete. Table is now flattened and type-safe.")
