## TODO
* remove current "mac" terminal - replace with - https://www.npmjs.com/package/xterm-for-react - check Dashboard.jsx for details
* REALIZED "runtime" is really the same a Process which is really the same as id which is the same as "the whole process" - connections in and out belong to "the whole process"
* WebRTC IS NOT activating venv when int does a pip install -r requirements
* WebRTC next .. need "minimal" actual "register" which locks with service description started by RobotLabXRuntime.ts
* add Johnny5 J5Servo and Node-Red
* focus on stdout from new process & Distributed rlx !
* figure out if registered is needed in RobotLabXRuntime.jsx .. or if getService should be unsubscribed.. and how "init" and "update" with new service works
* start doing unit tests - because your forgetting what has been done, and how much it works
* Refactor ... very simple .. full name for all services, all services register individually, including local runtime
* ! Configuration - Service.getConfig - make config executable like ROS config.js
* HATEOS - ability to query from top / non "cenralized" / and get all info regarding interfaces
* for repo package.yml for node services "same-process" should be an option, or shared process an option in both
  node and all platform stuff ... default for node would be true, default for python would be false ?
* need an "alias" table  ... which can condense a service@host@pid down to a single unique service name
* unsubscribe when move focus
* CodecUtil.ts is a mess between client and server
* get exe builds working

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