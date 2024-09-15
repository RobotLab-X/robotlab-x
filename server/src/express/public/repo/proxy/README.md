## Navigate to the Directory:
First, navigate to the directory where your robotlabx library is located. For example, if robotlabx is in ~/projects/robotlabx, you would do:

## Install the Module in Editable Mode:
Use pip with the -e option to install the module. Assuming robotlabx has a setup.py file, you would run:


Local
```sh
cd ~/projects/robotlabx
pip install -e .
```

## Installing from a Git Repository
If you want to install the module in development mode from a Git repository link, you can do this directly with pip as well:
```sh
pip install -e git+https://github.com/username/robotlabx.git#egg=robotlabx
```
