from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Any, Optional, Literal, Dict
import time
import json
import yaml
from database.types import DateTimeStr

class QueueSqsConfig(BaseModel):
    id: Optional[str] = Field("default", json_schema_extra={"example":"default"})
    name: Optional[str] = Field("default", description="The default name of this client", json_schema_extra={"example":"queue"})
    queue_url: Optional[str] = Field(None, description="SQS Queue Name or URL", json_schema_extra={"example":"https://sqs.us-west-2.amazonaws.com/123456789012/my-queue"})
    region_name: Optional[str] = Field(None, description="AWS Region Name", json_schema_extra={"example":"us-west-2"})
    aws_access_key_id: Optional[str] = Field(None, description="AWS Access Key ID", json_schema_extra={"example":"AKIAIOSFODNN7EXAMPLE"})
    aws_secret_access_key: Optional[str] = Field(None, description="AWS Secret Access Key", json_schema_extra={"example":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"})

# managed
    @classmethod
    def from_yaml(cls, yaml_str: str):
        """Load QueueSqsConfig from a YAML string."""
        data = yaml.safe_load(yaml_str)
        return cls(**data)

    @classmethod
    def from_yaml_file(cls, file_path: str):
        """Load QueueSqsConfig from a YAML file."""
        with open(file_path, "r") as file:
            return cls.from_yaml(file.read())

    @classmethod
    def from_json(cls, json_str: str):
        """Load QueueSqsConfig from a JSON string."""
        data = json.loads(json_str)
        return cls(**data)

    @classmethod
    def from_json_file(cls, file_path: str):
        """Load QueueSqsConfig from a JSON file."""
        with open(file_path, "r") as file:
            return cls.from_json(file.read())
