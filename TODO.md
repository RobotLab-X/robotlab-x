## TODO

### From ROS ROS2
* remapping - defaults are root names e.g. service@id@host/someOutput - how to remap and to what ? 
never needed to remap because root names change with names of services - my topic heirarchy is very flat.
implementation of re-mapping would be aliasing and managing alias in the nofiyLists and subscription system.
which would be possible ... but may not be worth the trouble
* Heh, ROS2 got rid of nodes that start nodes .. the lauch system is enhanced to be python files, and they have
a nice LifeCycleNode

### Other
* all std out from any process published -  eg. InstallPython also make different levels info, warn, error
* config "schema" defined in json that conforms to the form generation & will generate swagger as well
* services with platform icon - make it 1/2 in both dimentions and put it in right upper corner (transparent)
* connections (many per process at least 1), processes (many per host), hosts, services (1 to many per process)
* check put and get - add to unit tests
* subscriptions and even handling in node server 
* copy default.yml config --> config/configSet and any data created by service leave the rest immutable in repo
* home / dashboard with spash screen - with tutorial sets
* Mic - https://www.npmjs.com/package/mic
* Webcam - https://www.npmjs.com/package/react-webcam
* Ollama - https://www.npmjs.com/package/ollama