## OpenCV

### Install






```bash
cd server/express/public/repo/opencv

# activate venv
source ./.venv/bin/activate

python -u proxy.py -i cv -c http://localhost:3001

# FIXME - proxy.py should work (reconnect) without the need of RobotLabXRuntime.ts


# there is a setup.py and a requirements
# the purpose of this is to be a library, but minimally it should be capable to start a standalone service as well

# pip install -r requirements.txt?
# python start.py ?

```
