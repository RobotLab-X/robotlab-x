import os
from .tinydb import TinyDBDatabase

def get_database():
    backend = os.getenv("NOSQL_BACKEND", "tinydb").lower()
    return TinyDBDatabase()
