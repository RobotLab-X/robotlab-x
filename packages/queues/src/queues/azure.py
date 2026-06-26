from azure.storage.queue import QueueClient as AzureQueue
from .interface import QueueClient
from models.queue_azure_config import QueueAzureConfig

class AzureQueueClient(QueueClient):
    def __init__(self, config: QueueAzureConfig):
        self.config = config
        self.client = AzureQueue.from_connection_string(config.connection_string, config.queue_name)

    def send_message(self, message: str):
        self.client.send_message(message)

    def receive_message(self):
        messages = self.client.receive_messages()
        return next(iter(messages), None)

    def delete_message(self, message_id):
        self.client.delete_message(message_id)

    def get_message_count(self):
        props = self.client.get_queue_properties()
        return props.approximate_message_count
