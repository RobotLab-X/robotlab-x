import os
import yaml
from typing import Dict, Any, Optional

class Repo:
    def __init__(self, repo_dir: str = "./repo"):
        self.repo_dir = repo_dir

    def get_repo(self) -> dict:
        """
        Return a dict modeling the Node.js repo structure: {serviceName: {...package fields...}}
        Only include known fields, and map to camelCase as needed for compatibility.
        """
        repo = {}
        repo_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../public/repo')
        if not os.path.isdir(repo_dir):
            return repo
        for entry in os.listdir(repo_dir):
            service_dir = os.path.join(repo_dir, entry)
            package_file = os.path.join(service_dir, "package.yml")
            if os.path.isdir(service_dir) and os.path.isfile(package_file):
                with open(package_file, "r") as f:
                    try:
                        data = yaml.safe_load(f)
                        # Convert snake_case to camelCase for top-level keys
                        def to_camel(s):
                            parts = s.split('_')
                            return parts[0] + ''.join(x.title() for x in parts[1:])
                        repo[entry] = {to_camel(k): v for k, v in data.items()}
                    except Exception as e:
                        repo[entry] = {"error": str(e)}
        return repo

    def get_service_package(self, service_name: str) -> Optional[Dict[str, Any]]:
        """Return the package.yml contents for a given service, if it exists."""
        package_file = os.path.join(self.repo_dir, service_name, "package.yml")
        if os.path.isfile(package_file):
            with open(package_file, "r") as f:
                return yaml.safe_load(f)
        return None
