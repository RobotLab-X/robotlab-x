labels = [        
            "background",
            "aeroplane",
            "bicycle",
            "bird",
            "boat",
            "bottle",
            "bus",
            "car",
            "cat",
            "chair",
            "cow",
            "diningtable",
            "dog",
            "horse",
            "motorbike",
            "person",
            "pottedplant",
            "sheep",
            "sofa",
            "train",
            "tvmonitor"
        ]


def onNewFrame(frame, source):
    # print('onNewFrame', frame, source)
    pass


def onShowFrame(frame, source):
    # print('onShowFrame', frame, source)
    pass


def onNn(nn_packet, decoded_data):
    global labels
    # detected ['__class__', '__delattr__', '__dir__', '__doc__', '__eq__', '__format__', '__ge__', '__getattribute__', '__gt__', '__hash__', '__init__', '__init_subclass__',
    # '__le__', '__lt__', '__module__', '__ne__', '__new__', '__reduce__', '__reduce_ex__', '__repr__', '__setattr__', '__sizeof__', '__str__', 
    # '__subclasshook__', 'boundingBoxMapping', 'confidence', 'label', 'spatialCoordinates', 'xmax', 'xmin', 'ymax', 'ymin']
    for detected in decoded_data:
        # print(f'detected {dir(detected)}')
        print(f'{labels[detected.label]} {detected.confidence} {detected.xmin} {detected.ymin} {detected.xmax} {detected.ymax} {detected.spatialCoordinates.x} {detected.spatialCoordinates.y} {detected.spatialCoordinates.z}')


def onReport(report):
    print('onReport', report)
    pass


def onSetup(*args, **kwargs):
    print('onSetup', args, kwargs)
    pass


def onTeardown(*args, **kwargs):
    print('onSetup', args, kwargs)
    pass


def onIter(*args, **kwargs):
    # print('onIter', args, kwargs)
    pass
