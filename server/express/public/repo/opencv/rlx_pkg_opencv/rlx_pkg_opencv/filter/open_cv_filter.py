class OpenCVFilter:
    """
    Base class for OpenCV filters.
    """

    def __init__(self, name: str):
        self.name: str = name
        # FIXME do an import to resolve OpenCV
        self.opencv: any = None
        self.config = {}

    def apply_config(self, config: any):
        self.config = config

    def apply(self, frame):
        """
        Apply the filter to the pipeline.
        """
        print(f"Applying filter: {self.name}")
        return frame

    def to_dict(self):
        """
        Convert the filter to a dictionary for serialization.
        """
        return {
            "name": self.name,
            "typeKey": self.__class__.__name__,
            "config": self.config,
        }
