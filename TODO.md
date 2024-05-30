## TODO
* change the repo/service/{serviceName}/ -- all filenames same --- including config.yml
* DETERMINISTIC UNIT TESTS !!!
* add Ollama OpenAI Grok
* https://www.npmjs.com/package/rclnodejs ROS2 Node would be nice, but explodes in build
* Faster-Whisper -> https://www.youtube.com/watch?v=mdV8lETtGY4 (interesting demo)
* click on left card on Home.jsx and it collapses to only the services that are in that Node
* FIX - services/api/c1  will return blank if its a foriegn ID ... "if" unique should return c1@vigorous-robby
* Change Runtime to "Nodes" from title .. hide runtime .. so Node rlx1, Node rlx2 ...
* Make node graph
* Make reconnect
* Release Service
* reduce Store.handleMessage to nothing
* Make diagram ... "registerProcess" is the first most important client new connection request .. and if it's NOT done, a registerProcess will
  be generated auto-magically with a uuid for the register .. very similar to ROS !
* Make RobotLabXRuntime toJSON selectively serializable - make easy sync connectionArray and connections (non-serailizable)
* Add gateway as a parameter to adding a connection
* Configuration : Put all configuration in a component .. react form builder ?
* Borg - https://github.com/rhasspy/piper Small neural network
* FIXME - install must move to Service.ts
* each service "installs" .. or does a noop
* open source 3d robotics simulator - gazebo, 
* install - would you like to start ros ? would you like to use docker ?  install.yml ?
* state.yml and config.yml .. one is state the other config, one is how it currently is, the other is how you want it to be
* prefer https://www.npmjs.com/package/react-step-wizard or https://www.npmjs.com/package/react-use-wizard
* Configuration sets
* consoludate set of initial msgs addListener, register, registered, etc into "on" funtion which is called by setup in both client/server & ui
* https://www.npmjs.com/package/opencv4nodejs
* Ollama front end
* Aliases at some point !
* Robust disconnect, reconnect - grey/disable gui of gatewayId and all routes through client id
* add defaultId onto any raw "runtime" reference sent by the ui
* every incoming connection should identify a remote process, connecting with no additional info would mean the process definition should be generated
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


Gazebo is one of the most popular open-source robotics simulators. It provides a robust physics engine, high-quality graphics, and convenient programmatic and graphical interfaces.

Webots is an open-source robot simulator that offers a complete development environment to model, program, and simulate robots.

V-REP (CoppeliaSim)
CoppeliaSim, formerly known as V-REP, is a versatile and powerful robot simulation platform.

ARGoS is a modular, multi-robot simulator that allows the simulation of large-scale robot swarms.

OpenRAVE is a planning and simulation environment for robotics. It focuses on providing an environment for testing, developing, and deploying motion planning algorithms.

Unreal

Unity


docker run -d --network=host -v open-webui:/app/backend/data -e OLLAMA_BASE_URL=http://fast:11434 --name open-webui --restart always ghcr.io/open-webui/open-webui:main