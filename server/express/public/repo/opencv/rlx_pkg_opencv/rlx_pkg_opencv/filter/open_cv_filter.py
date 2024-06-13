class OpenCVFilter:
    """
    Base class for OpenCV filters.
    """
    def __init__(self, name):
        self.name = name
        self.config = {}

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
            "typeKey": "Filter"
        }
