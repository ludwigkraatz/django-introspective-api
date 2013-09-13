def get_access_key_model():
    from django.conf import settings
    from django.db.models.loading import get_model
    
    return get_model(*getattr(settings, 'INTROSPECTIVE_API__AUTH_ACCESS_KEY_MODEL', 'consumers.AccessKey').split('.'))

def get_consumer_model():
    from django.conf import settings
    from django.db.models.loading import get_model
    
    return get_model(*getattr(settings, 'INTROSPECTIVE_API__AUTH_CONSUMER_MODEL', 'consumers.Consumer').split('.'))
