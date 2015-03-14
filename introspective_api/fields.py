from rest_framework.fields import *
from rest_framework.relations import *
from django.core.exceptions import ValidationError
from introspective_api.reverse import reverse_nested as reverse  # TODO: implement app_name config arg

from django.db.models.fields import Field as BaseDjangoField, AutoField as BaseDjangoAutoField
import uuid

class HyperlinkedMetaField(Field):
    """
    for inheritence reasons
    """
    pk_url_kwarg = 'pk'
    slug_field = 'slug'
    slug_url_kwarg = None  # Defaults to same as `slug_field` unless overridden
    
    default_read_only = True
    pk_query_kwarg = None
    slug_query_kwarg = None
    
    query_kwarg_lookup = {}
    url_kwarg_lookup = {}
    
class HyperlinkedIdentityField(HyperlinkedIdentityField, HyperlinkedMetaField):
    """
    for inheritence reasons
    """

    def __init__(self, *args, **kwargs):        
        self.query_kwarg_lookup = kwargs.pop('query_kwarg_lookup', {})
        self.url_kwarg_lookup = kwargs.pop('url_kwarg_lookup', {})

        super(HyperlinkedIdentityField, self).__init__(*args, **kwargs)
    
class HyperlinkedRelatedField(HyperlinkedRelatedField, HyperlinkedMetaField):
    """
    for inheritence reasons
    """
    def __init__(self, *args, **kwargs):        
        self.query_kwarg_lookup = kwargs.pop('query_kwarg_lookup', {})
        self.url_kwarg_lookup = kwargs.pop('url_kwarg_lookup', {})

        super(HyperlinkedRelatedField, self).__init__(*args, **kwargs)

class HyperlinkedRelatedView(HyperlinkedMetaField):
    """
    Represents an related View and links to it.
    """
    pk_url_kwarg = 'pk'
    slug_field = 'slug'
    slug_url_kwarg = None  # Defaults to same as `slug_field` unless overridden
    
    default_read_only = True
    pk_query_kwarg = None
    slug_query_kwarg = None

    def __init__(self, view_name, *args, **kwargs):
        self.view_name = view_name
        self.view_namespace = kwargs.pop('view_namespace', Empty)
        self.format = kwargs.pop('format', None)

        self.query_kwarg_lookup = kwargs.pop('query_kwarg_lookup', {})
        self.url_kwarg_lookup = kwargs.pop('url_kwarg_lookup', {})
        self.slug_field = kwargs.pop('slug_field', self.slug_field)
        default_slug_kwarg = self.slug_url_kwarg or self.slug_field
        self.pk_url_kwarg = kwargs.pop('pk_url_kwarg', self.pk_url_kwarg)
        self.slug_url_kwarg = kwargs.pop('slug_url_kwarg', default_slug_kwarg)
        
        self.slug_query_kwarg = kwargs.pop('slug_query_kwarg', None)
        self.pk_query_kwarg = kwargs.pop('pk_query_kwarg', None)

        super(HyperlinkedRelatedView, self).__init__(*args, **kwargs)

    def initialize(self, parent, field_name):
        super(HyperlinkedRelatedView, self).initialize(parent, field_name)
        
        if self.view_namespace is Empty:
            self.view_namespace = getattr(self.parent.opts, 'view_namespace', None)
            
        if self.view_namespace:
            self.view_name = '%(namespace)s:%(name)s' % {'namespace': self.view_namespace, 'name': self.view_name} 

    def field_to_native(self, obj, field_name):
        
        if self.pk_query_kwarg:
            request = self.context.get('request', None)
            format = self.format or self.context.get('format', None)
            #view_namespace = self.view_namespace if self.view_namespace is not None else self.parent.opts.view_namespace
            view_name = self.view_name or self.parent.opts.view_name
            #if view_namespace:
            #    view_name = "%(namespace)s:%(view)s" % {
            #        'view':view_name,
            #        'namespace':view_namespace
            #    }
    
            pk = getattr(obj, 'pk')
            
            try:
                url = reverse(view_name, request=request, format=format)
                return  "%(url)s?%(query_kwarg)s=%(query_value)s" % {
                        'url': url,
                        'query_kwarg': self.pk_query_kwarg,
                        'query_value': pk
                        }
            except NoReverseMatch:
                pass
    
            raise ValidationError('Could not resolve URL for field using view name "%s"' % view_name)
        elif self.slug_query_kwarg:
            request = self.context.get('request', None)
            format = self.format or self.context.get('format', None)
            #view_namespace = self.view_namespace if self.view_namespace is not None else self.parent.opts.view_namespace
            view_name = self.view_name or self.parent.opts.view_name
            #if view_namespace:
            #    view_name = "%(namespace)s:%(view)s" % {
            #        'view':view_name,
            #        'namespace':view_namespace
            #    }
    
            slug = getattr(obj, self.slug_field, None)
    
            if not slug:
                raise ValidationError('Could not resolve URL for field using view name "%s"' % view_name)
    
            
            try:
                url = reverse(view_name, request=request, format=format)
                return  "%(url)s?%(query_kwarg)s=%(query_value)s" % {
                        'url': url,
                        'query_kwarg': self.slug_query_kwarg,
                        'query_value': slug
                        }
            except NoReverseMatch:
                pass
    
            raise ValidationError('Could not resolve URL for field using view name "%s"' % view_name)
        else:
            request = self.context.get('request', None)
            format = self.format or self.context.get('format', None)
            view_name = self.view_name or self.parent.opts.view_name
            kwargs = {self.pk_url_kwarg: obj.pk}
            try:
                return reverse(view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                pass
    
            slug = getattr(obj, self.slug_field, None)
    
            if not slug:
                raise ValidationError('Could not resolve URL for field using view name "%s"' % view_name)
    
            kwargs = {self.slug_url_kwarg: slug}
            try:
                return reverse(self.view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                raise
                pass
    
            kwargs = {self.pk_url_kwarg: obj.pk, self.slug_url_kwarg: slug}
            try:
                return reverse(self.view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                pass
    
            raise ValidationError('Could not resolve URL for field using view name "%s"', view_name)

    def from_native(self, value):
        raise Exception # readonly

import base64


class UUIDField(BaseDjangoField):
    def __init__(self, *args, **kwargs):
        self.auto = kwargs.pop('auto', False)    
        super(UUIDField, self).__init__(*args, **kwargs)
        
    def get_internal_type(self):
        return 'CharField'
    
    def db_type(self, connection):
        if connection.settings_dict['ENGINE'] == 'django.db.backends.postgresql_psycopg2':
            return 'uuid'
        elif connection.settings_dict['ENGINE'] == 'django.db.backends.mysql':
            return 'char(36)'#32??
        else:
            return 'char(36)'
    
    def to_python(self,value):
        """
        @brief returns a uuid version 1
        """
        if isinstance(value, uuid.UUID):
            return value
        else:
            return uuid.UUID(value) if value else None
        
    def pre_save(self, model_instance, add):
        """
        This is used to ensure that we auto-set values if required.
        See CharField.pre_save
        """
        value = getattr(model_instance, self.attname, None)
        if self.auto and add and not value:
            # Assign a new value for this attribute if required.
            uuid = self._create_uuid()
            setattr(model_instance, self.attname, uuid)
            value = uuid#.hex
        return value
    
    def _create_uuid(self, ):
        return uuid.uuid4()    
    
    def get_prep_value(self, value):
        """
        @brief returns the raw value of the data container
        """
        if value is None:
            return value
        if not isinstance(value, basestring):
            value = str(value)
        if len(value) in [32, 36]:
            return value
        
        return None
    
    def as_url(self):
        return base64.urlsafe_b64encode(self.uuid)
UuidField = UUIDField
class AutoUUIDField(UUIDField):
    def __init__(self, *args, **kwargs):
        kwargs['blank'] = True
        super(AutoUUIDField, self).__init__(*args, **kwargs)
        self.auto = True
    

    