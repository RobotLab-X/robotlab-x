import importlib


class Service:
    def __init__(self, id, name, typeKey, version, hostname):
        self.id = id
        self.name = name
        self.typeKey = typeKey
        self.version = version
        self.hostname = hostname
        self.notifyList = {}

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "typeKey": self.typeKey,
            "version": self.version,
            "hostname": self.hostname,
        }

    def __str__(self):
        return f"Service(id={self.id}, name={self.name}, typeKey={self.typeKey}, version={self.version}, hostname={self.hostname})"

    def __repr__(self):
        return self.__str__()

    def __eq__(self, other):
        return self.id == other.id and self.name == other.name

    def invoke(self, method_name, *args, **kwargs):
        self.invoke_on(self, self, method_name, *args, **kwargs)

    def invoke_on(self, instance, module_name, method_name, *args, **kwargs):
        try:
            # Import the module
            module = importlib.import_module(module_name)

            # Get the method from the instance
            method = getattr(instance, method_name)

            # Call the method with the provided arguments and keyword arguments
            result = method(*args, **kwargs)

            return result
        except ImportError:
            return f"Module {module_name} could not be imported."
        except AttributeError:
            return f"Method {method_name} not found in the instance of {module_name}."
        except Exception as e:
            return f"An error occurred: {e}"

    def add_listener(self, method_name, remote_name, remote_method):
        self.add_listener_on(self, self, method_name, remote_name, remote_method)

    def add_listener_on(
        self, instance, module_name, method_name, remote_name, remote_method
    ):
        # TODO - check if already exists
        self.notifyList[method_name] = [remote_name, remote_method]

    def remove_listener(self, method_name, remote_name, remote_method):
        self.remove_listener_on(self, self, method_name, remote_name, remote_method)

    def remove_listener_on(
        self, instance, module_name, method_name, remote_name, remote_method
    ):
        # TODO - check if already exists
        self.notifyList[method_name].remove(
            [remote_name, remote_method]
        )  # remove the entry
