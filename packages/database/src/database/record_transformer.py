import json
from typing import Any, Dict, List, Optional


class RecordTransformer:
    def __init__(self, json_fields: Optional[List[str]] = None):
        """
        :param json_fields: Optional list of field names to treat as JSON when unflattening.
                            If None, will attempt to auto-detect based on parseability.
        """
        self.json_fields = set(json_fields) if json_fields else None

    def flatten(self, obj: Dict[str, Any]) -> Dict[str, Any]:
        flat = {}
        for key, value in obj.items():
            if isinstance(value, (dict, list)):
                flat[key] = json.dumps(value)
            elif isinstance(value, str):
                flat[key] = value
            elif value is None:
                flat[key] = json.dumps({"__type__": "none", "value": None})
            elif isinstance(value, bool):
                flat[key] = json.dumps({"__type__": "bool", "value": value})
            elif isinstance(value, int):
                flat[key] = json.dumps({"__type__": "int", "value": value})
            elif isinstance(value, float):
                flat[key] = json.dumps({"__type__": "float", "value": value})
            else:
                # fallback: store as string
                flat[key] = str(value)
        return flat

    def unflatten(self, row: Dict[str, Any]) -> Dict[str, Any]:
        rehydrated = {}
        for key, value in row.items():
            if not isinstance(value, str):
                rehydrated[key] = value
                continue
            try:
                parsed = json.loads(value)
                if isinstance(parsed, (dict, list)):
                    # Check for our type marker
                    if isinstance(parsed, dict) and "__type__" in parsed:
                        t = parsed["__type__"]
                        v = parsed["value"]
                        if t == "int":
                            rehydrated[key] = int(v)
                        elif t == "float":
                            rehydrated[key] = float(v)
                        elif t == "bool":
                            rehydrated[key] = bool(v)
                        elif t == "none":
                            rehydrated[key] = None
                        else:
                            rehydrated[key] = v
                    else:
                        rehydrated[key] = parsed
                    continue
            except (json.JSONDecodeError, TypeError):
                pass
            rehydrated[key] = value
        return rehydrated
