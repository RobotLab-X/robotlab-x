# robotlab-x
Core Framework

Modern robotics framework with a focus on visualization

## Development

### Prerequisites

- Node.js v21.7.2 or higher
- Yarn v1.22.19 or higher

### Clone the repository

```bash
git clone https://github.com/RobotLab-X/robotlab-x.git
cd robotlab-x
```

### Install dependencies

```bash
yarn install-all
```

### Run the application

```bash
yarn start-dev
```

### OpenCV attach to RLX instance
```bash
cd /home/gperry/github/robotlab-x/server/express/public/repo/opencv/
source .venv/bin/activate
python -u proxy.py -i cv -c http://localhost:3001

```

### Client Development Environment

```bash
# .env
NODE_PATH=src
REACT_APP_API_KEY="REACT_APP_API_KEY_12345"
# Can be a lot of options with this
# One option is the difference between production and development
# Development is split into 2 different processes on 2 different ports
# Production is on a single port
# Security may want only localhost
# Flexibility may be to allow all or "some"
# your gonna forget about this, and its going to burn you
REACT_APP_BASE_URL="http://localhost:3001"
GENERATE_SOURCEMAP=false
```


## License

This project is licensed under the [Mozilla Public License 2.0](https://www.mozilla.org/en-US/MPL/2.0/).

