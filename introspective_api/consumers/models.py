from introspective_api.consumers.abstract_models import *

class Consumer(AbstractBaseConsumer):
    class Meta:
        swappable = 'INTROSPECTIVE_API__AUTH_CONSUMER_MODEL'
    
    id      = api_settings.AUTO_UUID_FIELD(primary_key=True)
    
    objects = ConsumerManager()

class AccessKey(AbstractBaseAccessKey):
    class Meta:
        swappable = 'INTROSPECTIVE_API__AUTH_CONSUMER_MODEL'
        
    id      = api_settings.AUTO_UUID_FIELD(primary_key=True)
    
    objects = AccessKeyManager()