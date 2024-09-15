from setuptools import setup, find_packages

setup(
    name="rlx_pkg_opencv",
    version="0.0.9",
    author="GroG",
    author_email="supertick@gmail.com",
    description="rlx_pkg_opencv",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    url="https://github.com/yourusername/robotlabxclient",
    packages=find_packages(),
    # FIXME - i don't think "websockets", "requests" - it was just brought over from the client
    install_requires=["jinja2", "typeguard"],
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.6",
)
