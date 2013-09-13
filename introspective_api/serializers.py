import re
import copy
from urlparse import urlsplit, urlunsplit

from django.http import QueryDict
from django.utils.http import urlencode
from django.utils.encoding import iri_to_uri
from django.utils.datastructures import SortedDict
from rest_framework.serializers import *

from introspective_api.fields import *
from introspective_api.reverse import reverse_to_patterns

# last import, because api_settings might be also in rest_framework *inherited* files
from introspective_api.settings import api_settings


##
# TODO - set update_fields when saving a partial updated model
##

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


    
def get_meta_fields(self, *args, **kwargs):
    ret = self.get_all_fields()
    
    for name in ret.keys():
        if not isinstance(ret[name], HyperlinkedMetaField):
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

def templatize_pattern_str(             pattern_string,             # the URL RegEx
                                         kwargs_lookup,             # the URL Kwargs dict
                                                                    # the keys are the URL kwargs
                                                                    # the values are the field_names
                                         querystrings,              # querystring params that are mandatory
                                         defaults,                  # default values when kw lookup misses
                                                                    # some field
                                         opt_querystrings=None      # optional querystring args, as pagination
                                         ):
    opt_querystrings = opt_querystrings or {}
    ret_string = pattern_string
    regex = r'(?:[?P\(<]*)(?P<name>[a-zA-Z0-9_]*)(?:[>\)\[\]\-\._\*]*)'
    '/(?P<all>\(?P\<(?P<name>[a-zA-Z0-9_]*)>\)[\[\]\-\._\*a-zA-Z0-9_?&%]*)'
    regex = r'\((.*?)\)'
    x=0
    # find groups
    for match in re.findall(regex, pattern_string):
        x+=1
        regex2 = '^\?P<(?P<name>[0-9a-zA-Z_]*)>'
        name = re.findall(regex2, match)[0]
        regex_local = r'\(\?P<%s>(.*?)\)' % name
        
        if name in kwargs_lookup:
            ret_string = re.sub(regex_local, '{{{var}}}'.format(var=iri_to_uri(kwargs_lookup[name])), ret_string, 1)
        elif name in defaults:
            ret_string = re.sub(regex_local, '{var}'.format(var=iri_to_uri(defaults[name])), ret_string, 1)
        else: raise Exception, match
        
    ret_string = re.sub(r'(^\^)', '', ret_string)
    ret_string = re.sub(r'(\$$)', '', ret_string)
    
    if querystrings:
        (scheme, netloc, path, query, fragment) = urlsplit(ret_string)
        query_dict = QueryDict(query).copy()
        for query_param, query_value in querystrings.iteritems():
            if query_value in kwargs_lookup:
                query_dict[query_param] = '{{{val}}}'.format(val=iri_to_uri(kwargs_lookup[query_value]))
            elif query_value in defaults:
                query_dict[query_param] = '{val}'.format(val=iri_to_uri(defaults[query_value]))
            else:
                raise KeyError, query_value
        
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

def field_to_template(self, field, field_name):
    
    view_name = field.view_name or field.parent.opts.view_name
    matching_patterns = reverse_to_patterns(view_name)
    opt_querystrings = {}
    querystring_dict = {}
    
    val = None
    for matches, pattern, defaults in matching_patterns:
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
                        cur_kwarg = self.opts.model._meta.pk.name
                    if field.url_kwarg_lookup and cur_kwarg in field.url_kwarg_lookup:
                        cur_kwarg = field.url_kwarg_lookup[cur_kwarg]
                        
                    # check if all fields for URL buidling are in the response
                    if cur_kwarg not in self.fields:
                        if cur_kwarg not in defaults:
                            raise Exception
                        
                    # check if all fields for querystring building are in the response
                    for field in querystring_dict.items():
                        if not field in self.fields:
                            if not field in defaults:
                                raise Exception
                            
                    cur_kwargs[kwarg] = cur_kwarg
            except:
                continue
            
            if field.pk_query_kwarg:
                if 'pk' not in cur_kwargs and self.opts.model._meta.pk.name not in cur_kwargs:
                    if self.opts.model._meta.pk.name in self.fields:
                        cur_kwargs[self.opts.model._meta.pk.name] = self.opts.model._meta.pk.name
                    else:
                        raise KeyError, self.opts.model._meta.pk.name
                querystring_dict[field.pk_query_kwarg] = self.opts.model._meta.pk.name
            if field.slug_query_kwarg:
                if field.slug_field not in cur_kwargs and field.slug_field in self.fields:
                    cur_kwargs[field.slug_field] = field.slug_field
                else:
                    raise KeyError, field.slug_field
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
        raise Exception, "'%s' could not be resolved" % field_name
    return val


class BaseSerializer(BaseSerializer):
    __metaclass__ = HeaderSerializerMetaclass
    
    _options_class = SerializerOptions
    def get_fields(self, *args, **kwargs):
        ret = super(BaseSerializer,self).get_fields(*args, **kwargs)
        
        if api_settings.RELATED_VIEWS_IN_HEADER:
            for name in ret.keys():
                if isinstance(ret[name], HyperlinkedRelatedView):
                    ret.pop(name)
        
        return ret
    
    get_meta_fields = get_meta_fields
    field_to_template = field_to_template
    
    
class Serializer(BaseSerializer):
    pass

class ModelSerializerOptions(ModelSerializerOptions):
    def __init__(self, meta):
        super(ModelSerializerOptions,self).__init__(meta)
        self.meta_fields = getattr(meta, 'meta_fields', ())
        self.exclude_meta = getattr(meta, 'exclude_meta', ())
    
class ModelSerializer(ModelSerializer):
    __metaclass__ = HeaderSerializerMetaclass
    
    _options_class = ModelSerializerOptions
    def get_fields(self, *args, **kwargs):
        ret = super(ModelSerializer,self).get_fields(*args, **kwargs)
        
        if api_settings.RELATED_VIEWS_IN_HEADER:
            for name in ret.keys():
                if isinstance(ret[name], HyperlinkedRelatedView):
                    ret.pop(name)
        
        return ret
    
    get_meta_fields = get_meta_fields
    field_to_template = field_to_template


class HyperlinkedModelSerializerOptions(HyperlinkedModelSerializerOptions):
    def __init__(self, meta):
        super(HyperlinkedModelSerializerOptions,self).__init__(meta)
        self.meta_fields = getattr(meta, 'meta_fields', ())
        self.exclude_meta = getattr(meta, 'exclude_meta', ())
        
class HyperlinkedModelSerializer(ModelSerializer):
    __metaclass__ = HeaderSerializerMetaclass
    _default_view_name = '%(model_name)s-detail'
    
    _options_class = HyperlinkedModelSerializerOptions    
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
                lookup_field=self.opts.lookup_field
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

