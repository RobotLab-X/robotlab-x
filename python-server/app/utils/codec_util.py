import logging
from typing import Optional

class CodecUtil:
    @staticmethod
    def get_id(name: str) -> Optional[str]:
        if not name:
            return None
        at_index = name.rfind("@")
        if at_index != -1:
            return name[at_index + 1:]
        else:
            return None

    @staticmethod
    def get_callback_topic_name(topic_method: str) -> str:
        def capitalize(s):
            return s[0].upper() + s[1:] if s else s
        if topic_method.startswith("publish"):
            return f"on{capitalize(topic_method[len('publish'):])}"
        elif topic_method.startswith("get"):
            return f"on{capitalize(topic_method[len('get'):])}"
        return f"on{capitalize(topic_method)}"

    @staticmethod
    def capitalize(s: str) -> str:
        return s[0].upper() + s[1:] if s else s

    @staticmethod
    def get_npm_package_name(type_: str) -> Optional[str]:
        if not type_:
            logging.error("Type is null")
            return None
        return f"rlx-pkg-{type_.lower()}"

    @staticmethod
    def is_local(name: str) -> bool:
        id_ = CodecUtil.get_id(name)
        return id_ == "local"
