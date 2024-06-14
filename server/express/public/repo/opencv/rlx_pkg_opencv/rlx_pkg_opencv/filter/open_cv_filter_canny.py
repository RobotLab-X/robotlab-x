import cv2
from .open_cv_filter import OpenCVFilter


class OpenCVFilterCanny(OpenCVFilter):
    """
    Canny edge detection filter.
    """

    def __init__(self, name, lower_threshold=50, upper_threshold=150):
        super().__init__(name)
        self.config = {
            "lower_threshold": lower_threshold,
            "upper_threshold": upper_threshold,
            "kernel": 3,
        }
        print("Canny Edge Detector initialized with thresholds: ")

    def apply(self, frame):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(
            gray,
            self.config.get("lower_threshold"),
            self.config.get("upper_threshold"),
            apertureSize=self.config.get("kernel"),
        )
        return edges


def main():
    # Initialize the filter
    canny_filter = OpenCVFilterCanny(
        name="Canny Edge Detector", lower_threshold=50, upper_threshold=150
    )

    # Capture video from the default camera
    cap = cv2.VideoCapture(0)

    if not cap.isOpened():
        print("Error: Could not open video stream")
        return

    while True:
        # Read a frame from the camera
        ret, frame = cap.read()
        if not ret:
            print("Error: Could not read frame")
            break

        # Apply the Canny filter to the frame
        edges = canny_filter.apply(frame)

        # Display the original frame and the edges frame
        cv2.imshow("Original", frame)
        cv2.imshow("Edges", edges)

        # Break the loop if the user presses 'q'
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    # Release the video capture object and close all OpenCV windows
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
