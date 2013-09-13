
from introspective_api.consumers.abstract_models import AbstractLimitedConsumer
from introspective_api.consumers.abstract_models import AbstractLimitedAccessKey
from introspective_api.consumers.abstract_models import ConsumerManager
from introspective_api.consumers.abstract_models import AccessKeyManager

class Consumer(AbstractLimitedConsumer):
    class Meta:
        pass
    
    objects = ConsumerManager()

class AccessKey(AbstractLimitedAccessKey):
    class Meta:
        pass
    
    objects = AccessKeyManager()