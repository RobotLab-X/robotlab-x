import logging
import boto3
import re
from .interface import QueueClient
from models.queue_sqs_config import QueueSqsConfig
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

class SQSQueue(QueueClient):
    def __init__(self, config: QueueSqsConfig):
        self.config = config
        region = SQSQueue.extract_region_from_url(config.queue_url)
        logger.info(f"initializing sqs queue with url: {config.queue_url} and region: {region}")

        session = boto3.Session(
            aws_access_key_id=config.aws_access_key_id,
            aws_secret_access_key=config.aws_secret_access_key,
            region_name=region
        )

        self.client = session.client("sqs")
        self.queue_url = config.queue_url

    def send_message(self, message: str):
        self.client.send_message(QueueUrl=self.queue_url, MessageBody=message)

    def receive_message(self):
        response = self.client.receive_message(QueueUrl=self.queue_url, MaxNumberOfMessages=1)
        messages = response.get("Messages", [])
        return messages[0] if messages else None

    def delete_message(self, message_id):
        self.client.delete_message(QueueUrl=self.queue_url, ReceiptHandle=message_id)

    def get_message_count(self):
        response = self.client.get_queue_attributes(QueueUrl=self.queue_url, AttributeNames=["ApproximateNumberOfMessages"])
        return response["Attributes"]["ApproximateNumberOfMessages"]

    @staticmethod
    def extract_region_from_url(queue_url):
        """Extracts AWS region from an SQS queue URL."""
        parsed_url = urlparse(queue_url)
        match = re.search(r"sqs\.(.*?)\.amazonaws\.com", parsed_url.netloc)
        return match.group(1) if match else None
    