from app.interfaces.registry import Registry

class InMemoryRegistry(Registry):
    _instance = None

    def __init__(self):
        self._services = {}

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def register(self, key, value):
        self._services[key] = value

    def release(self, key):
        if key in self._services:
            del self._services[key]

    def get_service(self, key):
        return self._services.get(key)

    def get_registry(self):
        return self._services

    def get_service_names(self):
        return list(self._services.keys())
