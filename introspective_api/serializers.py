import re
import copy
from django.utils.datastructures import SortedDict
from rest_framework.serializers import *

from introspective_api.fields import *

# last import, because api_settings might be also in rest_framework *inherited* files
from introspective_api.settings import api_settings


def messages(self):
    if hasattr(self, 'error_dict'):
        return [self.message_dict]
    return list(self)

def init(self, *args, **kwargs):
    return super(NestedValidationError, self).__init__(*args, **kwargs)


NestedValidationError.__init__ = init
NestedValidationError.messages = property(messages)


##
# TODO - set update_fields when saving a partial updated model
##

class _Serializer(object):
    pass

def _get_headers_fields(bases, attrs):
    fields = [(field_name, attrs.pop(field_name))
                for field_name, obj in attrs.items()
                if isinstance(obj, Field)
          ]
    fields.sort(key=lambda x: x[1].creation_counter)
    
    for base in bases[::-1]:
        if hasattr(base, 'fields'):
            fields = base.fields.items() + fields
            
    return SortedDict(fields)

def _get_header_fields(bases, attrs):
    fields = [(field_name, attrs['Header'].fields.pop(field_name))
                for field_name in attrs['Header'].fields.keys()
          ] if 'Header' in attrs else []
    
    for base in bases[::-1]:
        if hasattr(base, 'header_fields'):
            fields = base.header_fields.items() + fields
            
    return SortedDict(fields)

class HeaderSerializerMetaclass(SerializerMetaclass):
    def __new__(cls, name, bases, attrs):
        attrs['header_fields'] = _get_header_fields(bases, attrs)
        return super(HeaderSerializerMetaclass, cls).__new__(cls, name, bases, attrs)

class HeaderMetaClass(type):
    def __new__(cls, name, bases, attrs):
        attrs['fields'] = _get_headers_fields(bases, attrs)
        return super(HeaderMetaClass, cls).__new__(cls, name, bases, attrs)


class HeaderClass(object):
    __metaclass__ = HeaderMetaClass

class SerializerOptions(SerializerOptions):
    def __init__(self, meta):
        super(SerializerOptions,self).__init__(meta)
        self.meta_fields = getattr(meta, 'meta_fields', ())
        self.exclude_meta = getattr(meta, 'exclude_meta', ())
        self.defaults = getattr(meta, 'defaults', {})


    
def get_meta_fields(self, *args, **kwargs):
    ret = self.get_all_fields()
    for name in ret.keys():
        if isinstance(ret[name], _Serializer):
            serializer = ret.pop(name)
            for _name, _field in serializer.get_meta_fields().items():
                if not _name in ret:
                    ret[_name] = _field
        elif isinstance(ret[name], PrimaryKeyRelatedField):
            field = ret[name]
            model = field.queryset.model
            if hasattr(model, '_api_endpoint_detail') and getattr(model._api_endpoint_detail, 'view_name', False):
                endpoint = model._api_endpoint_detail
                ret[name] = HyperlinkedRelatedView(view_name=endpoint.get_complete_view_name(regular=True))
                ret[name].initialize(parent=self, field_name=name)
            else:
                ret.pop(name)
        elif not isinstance(ret[name], HyperlinkedMetaField):
            ret.pop(name)
        elif self.opts.meta_fields and name not in self.opts.meta_fields:
            ret.pop(name)
        elif name in self.opts.exclude_meta:
            ret.pop(name)
    
    
    #TODO test
    if hasattr(self, 'header_fields'):
        header_fields = copy.deepcopy(self.header_fields)
        for key, val in header_fields.items():
            if self.opts.meta_fields and key not in self.opts.meta_fields:
                pass
            elif key in self.opts.exclude_meta:
                pass
            else:
            #if key not in ret:
                ret[key] = val
                val.initialize(parent=self, field_name=key)
    
    return ret


def field_to_template(self, field, field_name, **extra):
    if hasattr(field, 'to_template'):
        return field.to_template(field_name, **extra)
    raise Exception('no valid field')


class BaseSerializer(BaseSerializer, _Serializer):
    __metaclass__ = HeaderSerializerMetaclass
    
    _options_class = SerializerOptions

    def __init__(self, *args, **kwargs):
        super(BaseSerializer, self).__init__(*args, **kwargs)

        if hasattr(self.context.get('view', None), 'endpoint'):
            if self.init_data is None:
                self.init_data = {}
            self.init_data.update(
                self.context['view'].endpoint.get_object_presets(
                    self.context['request'],
                    *self.context['view'].args,
                    **self.context['view'].kwargs
                )
            )

    def get_fields(self, *args, **kwargs):
        ret = super(BaseSerializer,self).get_fields(*args, **kwargs)
        
        if api_settings.RELATED_VIEWS_IN_HEADER:
            for name in ret.keys():
                if isinstance(ret[name], HyperlinkedRelatedView):
                    ret.pop(name)
        
        return ret
    
    get_meta_fields = get_meta_fields
    field_to_template = field_to_template
    
    
class Serializer(BaseSerializer, _Serializer):
    def __init__(self, *args, **kwargs):
        super(Serializer, self).__init__(*args, **kwargs)

        if hasattr(self.context.get('view', None), 'endpoint'):
            if self.init_data is None:
                self.init_data = {}
            self.init_data.update(
                self.context['view'].endpoint.get_object_presets(
                    self.context['request'],
                    *self.context['view'].args,
                    **self.context['view'].kwargs
                )
            )

class ModelSerializerOptions(ModelSerializerOptions):
    def __init__(self, meta):
        super(ModelSerializerOptions,self).__init__(meta)
        self.meta_fields = getattr(meta, 'meta_fields', ())
        self.exclude_meta = getattr(meta, 'exclude_meta', ())
        self.defaults = getattr(meta, 'defaults', {})
    
class ModelSerializer(ModelSerializer, _Serializer):
    __metaclass__ = HeaderSerializerMetaclass
    
    _options_class = ModelSerializerOptions
    def get_fields(self, *args, **kwargs):
        ret = super(ModelSerializer,self).get_fields(*args, **kwargs)
        
        if api_settings.RELATED_VIEWS_IN_HEADER:
            for name in ret.keys():
                if isinstance(ret[name], HyperlinkedRelatedView):
                    ret.pop(name)
        
        return ret

    def __init__(self, *args, **kwargs):
        super(ModelSerializer, self).__init__(*args, **kwargs)

        if hasattr(self.context.get('view', None), 'endpoint'):
            if self.init_data is None:
                self.init_data = {}
            elif hasattr(self.init_data, '_mutable'):
                self.init_data = copy.copy(self.init_data)
            self.init_data.update(
                self.context['view'].endpoint.get_object_presets(
                    self.context['request'],
                    *self.context['view'].args,
                    **self.context['view'].kwargs
                )
            )
    
    get_meta_fields = get_meta_fields
    field_to_template = field_to_template


class HyperlinkedModelSerializerOptions(HyperlinkedModelSerializerOptions):
    def __init__(self, meta):
        super(HyperlinkedModelSerializerOptions,self).__init__(meta)
        self.meta_fields = getattr(meta, 'meta_fields', ())
        self.exclude_meta = getattr(meta, 'exclude_meta', ())
        self.defaults = getattr(meta, 'defaults', {})
        self.pk_url_kwarg = getattr(meta, 'pk_url_kwarg', None)
        
class HyperlinkedModelSerializer(ModelSerializer, _Serializer):
    __metaclass__ = HeaderSerializerMetaclass
    _default_view_name = '%(model_name)s-detail'
    
    _options_class = HyperlinkedModelSerializerOptions


    def __init__(self, *args, **kwargs):
        super(HyperlinkedModelSerializer, self).__init__(*args, **kwargs)

        if hasattr(self.context.get('view', None), 'endpoint'):
            if self.init_data is None:
                self.init_data = {}
            self.init_data.update(
                self.context['view'].endpoint.get_object_presets(
                    self.context['request'],
                    *self.context['view'].args,
                    **self.context['view'].kwargs
                )
            )

    def get_fields(self, *args, **kwargs):
        ret = super(HyperlinkedModelSerializer,self).get_fields(*args, **kwargs)
        
        if api_settings.RELATED_VIEWS_IN_HEADER:
            for name in ret.keys():
                if isinstance(ret[name], HyperlinkedRelatedView):
                    ret.pop(name)
        
        return ret
    
    def get_default_fields(self):
        fields = super(HyperlinkedModelSerializer, self).get_default_fields()

        if self.opts.view_name is None:
            self.opts.view_name = self._get_default_view_name(self.opts.model)

        if '.' not in fields:
            url_field = HyperlinkedIdentityField(
                view_name=self.opts.view_name,
                lookup_field=self.opts.lookup_field,
                pk_url_kwarg=self.opts.pk_url_kwarg
            )
            ret = self._dict_class()
            ret['.'] = url_field
            ret.update(fields)
            fields = ret

        return fields
    
    def _get_default_view_name(self, model):
        """
        Return the view name to use if 'view_name' is not specified in 'Meta'
        """
        model_meta = model._meta
        format_kwargs = {
            'app_label': model_meta.app_label,
            'model_name': model_meta.object_name.lower()
        }
        return self._default_view_name % format_kwargs
    
    get_meta_fields = get_meta_fields
    field_to_template = field_to_template

