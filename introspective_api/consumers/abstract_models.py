from django.utils.timezone import now
from django.db import models
from django.db.models import Model, Manager
from django.db.models import fields
from django.contrib.auth.hashers import make_password
from django.conf import settings
import datetime


from introspective_api.settings import api_settings


def valid_from_default():
    return now()

def valid_until_default():
    """
    @brief per default, an access key should be valid for 18h
    """
    return valid_from_default() +   datetime.timedelta(hours=18)

class AbstractBaseConsumer(Model):
    class Meta:
        abstract = True

    #id                  =   api_settings.AUTO_UUID_FIELD(primary_key=True)
    created             =   models.DateTimeField(auto_now_add=True)
    identifier          =   models.TextField(unique=True)
    description         =   models.TextField()

class AccessKeyUserWrapper(object):
    def __init__(self, user):
        self.__user = user
    def __getattr__(self, attr_name, default=None):
        if attr_name in self.__own:
            pass
        pass
class AccessKeyCustomerWrapper(object):
    def __init__(self, key):
        self.__key = key
    def __getattr__(self, attr_name, default=None):
        if attr_name in self.__own:
            pass
        pass

class AbstractBaseAccessKey(Model):
    class Meta:
        abstract = True
        
    #id          =   api_settings.AUTO_UUID_FIELD(primary_key=True)
    created     =   models.DateTimeField(auto_now_add=True)
    
    # timezone information of client
    #tz          = models.TimezoneField(null=True, blank=True)
    #identifier  =   models.TextField(unique=True)
    secret      =   models.TextField()
    algorithm   =   models.TextField(default="sha256", choices=(('sha256', 'sha256'),))
    user        =   models.ForeignKey(settings.AUTH_USER_MODEL, related_name='%(app_label)s__access_keys', editable=False, null=True, blank=True)
    consumer    =   models.ForeignKey("Consumer", related_name="access_keys", editable=False)
    
    
    _artifacts = {}
    
    def get_user(self, ):
        return self.user if self.user else None#AccessKeyCustomerWrapper(self)
        return AccessKeyUserWrapper(self.user) if self.user else AccessKeyCustomerWrapper(self)
    
    def is_valid(self, ):
        return True
    
    def _update_client_settings(self, settings):
        update_fields = []
        if 'algorithm' in settings:
            algorithm = settings.pop('algorithm')
            if algorithm != self.algorithm:
                self.algorithm = algorithm
                update_fields.append('algorithm')
        
        return update_fields    
    
    def update_client_setings(self, settings):
        update_fields = self._update_client_settings(settings)
            
        if update_fields:
            self.save(update_fields=update_fields)
            
        return update_fields            
    
    def as_credentials(self, ):
        """ used for javascript responses """
        return {
            "accessId": str(self.id),
            "accessSecret": str(self.secret),
            "accessAlgorithm": str(self.algorithm)
        }
    
    def as_internal_credentials(self, ):
        """ used for hawk python lib and internal stuff """
        return {
            "id": str(self.id),
            "key": str(self.secret),
            "algorithm": str(self.algorithm)
        }
    
    
    
    def set_artifacts(self, artifacts):
        self._artifacts = artifacts
        
    def get_artifacts(self):
        return self._artifacts


class AbstractLimitedConsumer(AbstractBaseConsumer):
    class Meta:
        abstract = True
    valid_from  =   models.DateTimeField(default=valid_from_default)
    valid_until =   models.DateTimeField(default=valid_until_default)
    usable_as   =   models.ManyToManyField('auth.Group', related_name='registered_consumers')
    usable_for  =   models.ManyToManyField('auth.Permission', related_name='registered_consumers')
    successor   =   models.ForeignKey('self', related_name='ancestors', null=True, blank=True)


class AbstractLimitedAccessKey(AbstractBaseAccessKey):
    """
        a limited Access Key inherits its valid_*, usable_* attributes by its consumer and user.
    """
    class Meta:
        abstract = True
    valid_from  =   models.DateTimeField(default=valid_from_default)
    valid_until =   models.DateTimeField(default=valid_until_default)
    usable_for  =   models.ManyToManyField('auth.Permission', related_name='registered_keys')
    successor   =   models.ForeignKey('self', related_name='ancestors', null=True, blank=True)

    def is_valid(self, ):
        _now = now()
        return self.valid_from <= _now and self.valid_until > _now

class ConsumerManager(Manager):
    def create_user(self, *args, **kwargs):
        new_kwargs = {
            "id": kwargs.pop("username"),
            "secret": kwargs.pop('password')
        }
        new_kwargs.update(kwargs)
        self.create_consumer(*args, **new_kwargs)
    def create_consumer(self, description, **useless):
        return self.create()

class AccessKeyManager(Manager):
    def create_user(self, *args, **kwargs):
        new_kwargs = {
            "id": kwargs.pop("username"),
            "secret": kwargs.pop('password')
        }
        new_kwargs.update(kwargs)
        self.create_key(*args,**new_kwargs)
    def create_key(self, user, **useless):
        return self.create(user = user)
