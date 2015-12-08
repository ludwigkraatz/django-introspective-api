from rest_framework.fields import *
from rest_framework.relations import *
from django.core.exceptions import ValidationError
from introspective_api.reverse import reverse_nested as reverse  # TODO: implement app_name config arg


from introspective_api.reverse import reverse_to_patterns
from urlparse import urlsplit, urlunsplit
from django.http import QueryDict
from django.utils.http import urlencode
from django.utils.encoding import iri_to_uri
from introspective_api.settings import api_settings


from django.db.models.fields import Field as BaseDjangoField, AutoField as BaseDjangoAutoField
import uuid
import copy
from functools import partial
from introspective_api.exceptions import ResolveError, ResolveKeyError


def templatize_pattern_str(             pattern_string,             # the URL RegEx
                                         kwargs_lookup,             # the URL Kwargs dict
                                                                    # the keys are the URL kwargs
                                                                    # the values are the field_names
                                         querystrings,              # querystring params that are mandatory
                                         defaults,                  # default values when kw lookup misses
                                                                    # some field
                                         opt_querystrings=None      # optional querystring args, as pagination
                                         ):

    pattern_string.replace('()', '\(\)')
    opt_querystrings = opt_querystrings or {}
    ret_string = pattern_string
    regex = r'(?:[?P\(<]*)(?P<name>{valid_patterns_expr})(?:[>\)\[\]\-\._\*]*)'
    '/(?P<all>\(?P\<(?P<name>{valid_patterns_expr})>\)[\[\]\-\._\*a-zA-Z0-9_?&%]*)'.format(
        valid_patterns_expr=api_settings.VALID_URL_PATTERNS_EXPR # TODO: QUERY expr also
    )
    regex = r'\((.*?)\)'
    x=0
    # find groups
    for match in re.findall(regex, pattern_string):
        x+=1
        regex2 = '^\?P<(?P<name>{valid_patterns_expr})>'.format(valid_patterns_expr=api_settings.VALID_URL_PATTERNS_EXPR)
        name = re.findall(regex2, match)[0]
        regex_local = r'\(\?P<{name}>[{valid_patterns_expr}]*\)'.format(valid_patterns_expr=re.escape(api_settings.VALID_URL_PATTERNS_EXPR), name=name)
        
        if name in defaults:
            ret_string = re.sub(regex_local, '{var}'.format(var=iri_to_uri(defaults[name])), ret_string, 1)
        elif name in kwargs_lookup:
            ret_string = re.sub(regex_local, '{{{var}}}'.format(var=iri_to_uri(kwargs_lookup[name])), ret_string, 1)
        else: raise ResolveError(match)
        
    ret_string = re.sub(r'(^\^)', '', ret_string)
    ret_string = re.sub(r'(\$$)', '', ret_string)
    
    if querystrings:
        (scheme, netloc, path, query, fragment) = urlsplit(ret_string)
        query_dict = QueryDict(query).copy()
        for query_param, query_value in querystrings.iteritems():
            if query_value in defaults:
                query_dict[query_param] = '{val}'.format(val=iri_to_uri(defaults[query_value]))
            elif query_value in kwargs_lookup:
                query_dict[query_param] = '{{{val}}}'.format(val=iri_to_uri(kwargs_lookup[query_value]))
            else:
                raise ResolveKeyError(query_value)
        
        template_string = ''
        templatized_qs = []
        
        for query_param, query_value in opt_querystrings.iteritems():
            if query_value:
                query_dict[query_param] = '{val}'.format(val=iri_to_uri(query_value))
            else:
                templatized_qs.append(query_param)
        query = query_dict.urlencode(safe='{}')
        
        if templatized_qs:
            template_expression = '&' if query else '?'
            template_string = '{{{expression}{query_args}}}'.format(expression=template_expression,query_args=','.join(iri_to_uri(templatized_qs)))
        
        ret_string = urlunsplit((scheme, netloc, path, query+template_string, fragment))
            
    return ret_string


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
    # subclasses can define defaults
    defaults = {}


    def to_template(self, field_name):
        field = self
        view_name = getattr(field, 'view_name', None) or field.parent.opts.view_name
        matching_patterns = reverse_to_patterns(view_name)
        opt_querystrings = {}
        querystring_dict = {}

        val = None
        for matches, pattern, _defaults in matching_patterns:
            defaults = copy.copy(_defaults)  # TODO: really?
            if field.parent.opts.defaults:
                defaults.update(field.parent.opts.defaults)
            if field.defaults:
                defaults.update(field.defaults)

            for pattern_string, kwargs in matches:
                cur_kwargs = {}
                try:
                    for kwarg in kwargs:
                        cur_kwarg = kwarg
                        if field.pk_url_kwarg and cur_kwarg == field.pk_url_kwarg:
                            cur_kwarg = 'pk'
                        if field.slug_url_kwarg and cur_kwarg == field.slug_url_kwarg:
                            cur_kwarg = field.slug_field
                        if cur_kwarg == 'pk':
                            cur_kwarg = self.parent.opts.model._meta.pk.name
                        if field.url_kwarg_lookup and cur_kwarg in field.url_kwarg_lookup:
                            cur_kwarg = field.url_kwarg_lookup[cur_kwarg]
                            if hasattr(cur_kwarg, '__call__'):
                                cur_kwarg = cur_kwarg()
                            
                        # check if all fields for URL buidling are in the response
                        if cur_kwarg not in self.parent.fields:
                            if cur_kwarg not in defaults:
                                raise ResolveError()
                            
                        # check if all fields for querystring building are in the response
                        for field in querystring_dict.items():
                            if not field in self.parent.fields:
                                if not field in defaults:
                                    raise ResolveError()
                                
                        cur_kwargs[kwarg] = cur_kwarg
                except ResolveError:
                    continue
                
                if field.pk_query_kwarg:
                    if 'pk' not in cur_kwargs and self.parent.opts.model._meta.pk.name not in cur_kwargs:
                        if self.parent.opts.model._meta.pk.name in self.parent.fields:
                            cur_kwargs[self.parent.opts.model._meta.pk.name] = self.parent.opts.model._meta.pk.name
                        else:
                            raise ResolveKeyError, self.parent.opts.model._meta.pk.name
                    querystring_dict[field.pk_query_kwarg] = self.parent.opts.model._meta.pk.name
                if field.slug_query_kwarg:
                    if field.slug_field not in cur_kwargs and field.slug_field in self.parent.fields:
                        cur_kwargs[field.slug_field] = field.slug_field
                    else:
                        raise ResolveKeyError, field.slug_field
                    querystring_dict[field.slug_query_kwarg] = field.slug_field 
                if field.query_kwarg_lookup:
                    querystring_dict.update(field.query_kwarg_lookup)       
                
                val = templatize_pattern_str(pattern,
                                             kwargs_lookup=cur_kwargs,
                                             querystrings=querystring_dict,
                                             defaults=defaults,
                                             opt_querystrings=opt_querystrings)
                break
        if val is None:
            raise ResolveError("'%s' could not be resolved" % field_name)
        
        request = self.context.get('request', None)
        if request:
            val = request.build_absolute_uri('/') + val
        else:
            val = ('/' if not val.startswith('/') else '') + val
        return val
    
class HyperlinkedIdentityField(HyperlinkedIdentityField, HyperlinkedMetaField):
    """
    for inheritence reasons
    """

    def __init__(self, *args, **kwargs):        
        self.query_kwarg_lookup = kwargs.pop('query_kwarg_lookup', {})
        self.url_kwarg_lookup = kwargs.pop('url_kwarg_lookup', {})
        """
        url_kwarg_lookup lambda obj=None, attr_name=None: attr_name if not obj else getattr(obj, attr_name, None)
        """
        self.defaults = kwargs.pop('defaults', None)

        super(HyperlinkedIdentityField, self).__init__(*args, **kwargs)


    def get_url(self, obj, view_name, request, format):
        """
        Given an object, return the URL that hyperlinks to the object.

        May raise a `NoReverseMatch` if the `view_name` and `lookup_field`
        attributes are not configured to correctly match the URL conf.
        """
        defaults = {}
        if self.parent.opts.defaults:
            defaults.update(self.parent.opts.defaults)
        if self.defaults:
            defaults.update(self.defaults)

        lookup_field = getattr(obj, self.lookup_field)
        kwargs = {self.lookup_field: lookup_field}
        kwargs.update(defaults)
        try:
            return reverse(view_name, kwargs=kwargs, request=request, format=format)
        except NoReverseMatch:
            pass

        if self.pk_url_kwarg != 'pk':
            # Only try pk lookup if it has been explicitly set.
            # Otherwise, the default `lookup_field = 'pk'` has us covered.
            kwargs = {self.pk_url_kwarg: obj.pk}
            kwargs.update(defaults)
            try:
                return reverse(view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                pass

        slug = getattr(obj, self.slug_field, None)
        if slug:
            # Only use slug lookup if a slug field exists on the model
            kwargs = {self.slug_url_kwarg: slug}
            kwargs.update(defaults)
            try:
                return reverse(view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                pass

        raise NoReverseMatch()
    
class HyperlinkedRelatedField(HyperlinkedRelatedField, HyperlinkedMetaField):
    """
    for inheritence reasons
    """
    def __init__(self, *args, **kwargs):        
        self.query_kwarg_lookup = kwargs.pop('query_kwarg_lookup', {})
        self.url_kwarg_lookup = kwargs.pop('url_kwarg_lookup', {})

        super(HyperlinkedRelatedField, self).__init__(*args, **kwargs)


class HyperlinkedRelativeField(HyperlinkedMetaField):
    """
    works best, if used with a HyperlinkedModelSerializer, as this ensures the view has a valid content url returned by getContentURL
    """
    def __init__(self, target, template_pattern, *args, **kwargs):
        super(HyperlinkedRelativeField, self).__init__(*args, **kwargs)
        self.relative_target = target
        self.relative_template_pattern = template_pattern

    def field_to_native(self, obj, field_name):
        view = self.context.get('view', None)
        request = self.context.get('request', None)
        target = self.relative_target + '/'

        if view and hasattr(view, 'getContentURL'):
            uri = view.getContentURL()

            if hasattr(view, 'prepare_uri_for_header'):
                return view.prepare_uri_for_header(uri=target, uri_prefix=uri)
            return uri + target

        if request:
            return request.build_absolute_uri(target)
        return targeturl_kwarg_lookup

    def to_template(self, field_name):
        view = self.context.get('view', None)
        request = self.context.get('request', None)
        target = ('{{{var}}}/'.format(var=iri_to_uri(self.relative_template_pattern))) + self.relative_target + '/'

        if view and hasattr(view, 'getContentURL'):
            uri = view.getContentURL()

            if hasattr(view, 'prepare_uri_for_header'):
                return view.prepare_uri_for_header(uri=target, uri_prefix=uri)
            return uri + target

        if request:
            uri = request.build_absolute_uri()
            query = None
            if '?' in uri:
                uri, query = uri.split('?')

            return uri + target
        return target


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
    defaults = None

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
        self.defaults = kwargs.pop('defaults', None)
        
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
        defaults = {}
        if self.parent.opts.defaults:
            defaults.update(self.parent.opts.defaults)
        if self.defaults:
            defaults.update(self.defaults)

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
                url = reverse(view_name, kwargs=defaults, request=request, format=format)
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
                url = reverse(view_name, kwargs=defaults, request=request, format=format)
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
            kwargs.update(defaults)
            try:
                return reverse(view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                pass
    
            kwargs = {}
            for key, value in self.url_kwarg_lookup.items():
                kwargs[key] = value(obj) if hasattr(value, '__call__') else getattr(obj, value, None)
            
            kwargs.update(defaults)
            try:
                return reverse(self.view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
                raise
                pass
            

            slug = getattr(obj, self.slug_field, None)
    
            if not slug:
                raise ValidationError('Could not resolve URL for field using view name "%s"' % view_name)
    
            kwargs = {self.slug_url_kwarg: slug}
            kwargs.update(defaults)
            try:
                return reverse(self.view_name, kwargs=kwargs, request=request, format=format)
            except NoReverseMatch:
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


class UUIDCharField(UUIDField):
    def get_internal_type(self):
        return 'CharField'

    def db_type(self, connection):
        return 'char(36)'

    def to_python(self,value):
        """
        @brief returns a uuid version 1
        """
        if isinstance(value, basestring):
            return value
        else:
            return str(value) if value else None

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



def new_metadata(self):
    metadata = SortedDict()
    metadata['type'] = self.type_label
    metadata['required'] = getattr(self, 'required', False)
    optional_attrs = ['read_only', 'label', 'help_text',
                      'min_length', 'max_length', 'choices']
    for attr in optional_attrs:
        value = getattr(self, attr, None)
        if value is not None and value != '':
            metadata[attr] = value if isinstance(value, list) else force_text(value, strings_only=True)
    return metadata


ChoiceField.type_label = 'string'
old_metadata = ChoiceField.metadata
ChoiceField.metadata = new_metadata

#
#class DataSerializerField(WritableField):
#    def __init__(self, serializer, *args, **kwargs):
#        self._serializer_class = serializer
#        self._serializer = None
#        if not 'required' in kwargs:
#            kwargs['required'] = False
#        super(DataSerializerField, self).__init__(*args, **kwargs)
#
#    @property
#    def serializer(self):
#        if self._serializer is None:
#            self._serializer = self._serializer_class()
#        return self._serializer
#
#    @serializer.setter
#    def _serializer_setter(self, value):
#        self._serializer = value
#
#    def initialize(self, parent, field_name):
#        super(DataSerializerField, self).initialize(parent, field_name)
#
#    def field_from_native(self, data, files, field_name, into):
#        """
#        Given a dictionary and a field name, updates the dictionary `into`,
#        with the field and it's deserialized value.
#        """
#        instance = getattr(self.parent, 'object', None)
#        self.serializer = self._serializer_class(instance.data if instance else None, data=data, files=files,
#                                many=self.parent.many,
#                                partial=self.parent.partial,
#                                context=self.parent.context
#                                  )
#        if self.serializer.is_valid():
#            return super(DataSerializerField, self).field_from_native(data, files, field_name, into)
#        raise ValidationError(self.serializer.errors)
#            #into[field_name] = data  # TODO: files? use more of the serializer?
#
#    def field_to_native(self, obj, field_name):
#        return obj.data
#
#


class DictField(WritableField):

    def field_from_native(self, data, files, field_name, into):
        """
        Dicts of native values <- Dicts of primitive datatypes.
        """
        into[field_name] = data

    def field_to_native(self, obj, field_name):
        return getattr(obj, field_name)

