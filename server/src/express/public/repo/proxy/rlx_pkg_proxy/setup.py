from setuptools import setup, find_packages

setup(
    name="rlx_pkg_proxy",
    version="0.0.9",
    author="GroG",
    author_email="grog@robotlab-x.com",
    description="RobotLabX Client Proxy Package",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/RobotLab-X/rlx_pkg_proxy",
    packages=find_packages(),
    install_requires=["websockets", "requests", "pyyaml", "jinja2", "typeguard"],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.6",
)
