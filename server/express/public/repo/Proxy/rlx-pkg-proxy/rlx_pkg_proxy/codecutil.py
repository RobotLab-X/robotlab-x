# class RobotLabXRuntime:
#     @staticmethod
#     def getInstance():
#         return RobotLabXRuntime()

#     def getId(self):
#         # Placeholder for actual implementation
#         return "runtime_id"

import re

class CodecUtil:

    # process id
    id = None

    @staticmethod
    def camel_to_snake(name):
        s1 = re.sub('(.)([A-Z][a-z]+)', r'\1_\2', name)
        s2 = re.sub('([a-z0-9])([A-Z])', r'\1_\2', s1)
        return s2.lower()

    @staticmethod
    def get_full_name(name: str | None) -> str | None:
        if name is None:
            return None

        if CodecUtil.get_id(name) is None:
            return f"{name}@{CodecUtil.id}"
        else:
            return name

    @staticmethod
    def get_id(name: str | None) -> str | None:
        if not name:
            return None
        at_index = name.rfind("@")
        if at_index != -1:
            return name[at_index + 1:]
        else:
            return None

    @staticmethod
    def get_callback_topic_name(topic_method: str) -> str:
        if topic_method.startswith("publish"):
            return f"on{CodecUtil.capitalize(topic_method[len('publish'):])}"
        elif topic_method.startswith("get"):
            return f"on{CodecUtil.capitalize(topic_method[len('get'):])}"
        return f"on{CodecUtil.capitalize(topic_method)}"

    @staticmethod
    def capitalize(s: str) -> str:
        return s[0].upper() + s[1:] if s else s

# Example usage
if __name__ == "__main__":
    print(CodecUtil.get_full_name("example"))
    print(CodecUtil.get_id("example@id"))
    print(CodecUtil.get_callback_topic_name("publishMethod"))
    print(CodecUtil.get_callback_topic_name("getMethod"))
    print(CodecUtil.capitalize("hello"))
