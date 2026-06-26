import os
from database.tinydb import TinyDBDatabase  # ✅ Correct

def get_database():
    backend = os.getenv("NOSQL_BACKEND", "tinydb").lower()
    return TinyDBDatabase()
