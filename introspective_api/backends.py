
from introspective_api import get_access_key_model, get_consumer_model

class ConsumerAuthentication(object):
    """
    Authenticates against introspective_api.consumer models.
    """
    
    def authenticate(self, request):
        consumer_key=None
        consumer_secret=None
        access_key=None
        access_secret=None
        try:
            consumer = get_consumer_model().objects.get_by_natural_key(consumer_key)
            
            if consumer.check_password(consumer_secret):
                if consumer.is_active:
                    user_access = get_access_key_model().objects.get_by_natural_key(access_key)
                    
                    if user_access.check_password(access_secret):
                        if user_access.is_active:
                            return user_access, None
                
        except get_consumer_model().DoesNotExist:
            return None
        except get_access_key_model().DoesNotExist:
            return None
        
class SessionAuthentication(object):
    """
    Authenticates against introspective_api.consumer models.
    """
    
    def authenticate(self, request):
        consumer_key=None
        consumer_secret=None
        access_key=None
        access_secret=None
        try:
            consumer = get_consumer_model().objects.get_by_natural_key(consumer_key)
            
            if consumer.check_password(consumer_secret):
                if consumer.is_active:
                    user_access = get_access_key_model().objects.get_by_natural_key(access_key)
                    
                    if user_access.check_password(access_secret):
                        if user_access.is_active:
                            return user_access, None
                
        except get_consumer_model().DoesNotExist:
            return None
        except get_access_key_model().DoesNotExist:
            return None