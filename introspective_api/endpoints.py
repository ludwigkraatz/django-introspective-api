from django.conf.urls import url, patterns, include
from django.core.exceptions import ImproperlyConfigured

from django.views.generic import View as ViewClass
from introspective_api.views import APIView, RedirectView, EndpointView
from introspective_api.settings import api_settings

ApiResponse = api_settings.API_RESPONSE_CLASS

from django.conf import settings

import copy


class EndpointFilterBackend(object):
    def filter_queryset(self, request, queryset, view):
        endpoint_filter = view.endpoint.get_object_filter(request, *view.args, **view.kwargs)
        return queryset.filter(**endpoint_filter)


class ApiEndpointMixin(object):
    SELECTOR_ENDPOINT = 'select' #TODO: Select should return 0/1, filter many
    FILTER_ENDPOINT = 'filter'
    REDIRECT_ENDPOINT = 'redirect'
    ROOT_ENDPOINT = 'root'

    def __init__(self, **config):
        self._endpoint_registry = {}
        self._endpoints = {}
        self.links = {}

        self.type       = config.pop('type', None)
        self.namespace  = config.pop('namespace', None)
        self.app_name   = config.pop('app_name', None)

    def get_complete_namespace(self, post_fix=False, regular=False):
        """
        @brief concats the namespaces from this and all parent endpoints
        """
        seperator = '.' if not regular else ':'
        namespace = (self.namespace or '') + ('' if regular or not self.app_name else ((seperator if self.namespace else '' ) + self.app_name))
        parent_namespace = (self.parent or self.root).get_complete_namespace(regular=regular)

        if parent_namespace and namespace:
            if regular:
                namespace  = seperator.join([parent_namespace, namespace])
            else:
                namespace  = seperator.join([parent_namespace, namespace][::-1])
        else:
            namespace  = parent_namespace or namespace

        if namespace:
            return namespace + (seperator if post_fix else '')
        else:
            return None

    def get_complete_app_name(self, post_fix=False):
        """
        @brief concats the namespaces from this and all parent endpoints
        """
        app_name = self.app_name
        parent_app_name = (self.parent or self.root).get_complete_app_name()

        if parent_app_name and app_name:
            app_name  = '.'.join([parent_app_name, app_name][::-1])
        else:
            app_name  = parent_app_name or app_name

        if app_name:
            return app_name + ('.' if post_fix else '')
        else:
            return None


    def get_absolute_name(self, current_app=None):
        """
        @brief the absolute name of this *view*. This includes all namespaces this view is within.
        """
        namespace = self.get_complete_namespace(regular=True)

        if namespace:
            return '%s:%s' % (namespace, self.name)

        return self.name

    def activate(self, name):
        """
        @brief an endpoint can be activated explicitly, if not done when it was registered
        """
        self._endpoint_registry[name] = True

    def deactivate(self, name):
        """
        @brief an endpoint can be deactivated explicitly, if not done when it was registered
        """
        self._endpoint_registry[name] = False
    """
    def get_or_register_endpoint(self, *args, **kwargs):
        try:
            return self.register_endpoint(*args, **kwargs)
        except ImproperlyConfigured:
            return self.get_endpoint(*args, **kwargs)

    def get_endpoint(self, name, **config):
        if name in self._endpoints:
            # TODO: filter correct endpoint by config...
            return self._endpoints[name][0]
        raise Exception('Endpoint "%s" not found' % name)
    """

    def register_endpoint(self, name, **config):
        """
        @brief this method registers a standard endpoint as "child" of the current one
        """
        #if not ("view" in config):
        #    # e.g. @register_endpoint.***('somename') or @register_endpoint.***(name='somename',..)
        #    def dec(view):
        #        if not view:
        #            raise ImproperlyConfigured, 'view argument missing'
        #        return getattr(self, 'register_endpoint')(name, view=view, **kwargs)
        #    return dec

        return self._register_endpoint(name, **config)

    def register_selector(self, name, pattern, **config):
        """
        @brief a selector is an endpoint that is applied on the current "collection kind" endpoint and results in (n)one result.
        """
        config['type']      = self.SELECTOR_ENDPOINT
        config['pattern']   = pattern
        return self.register_endpoint(name, **config)

    def register_filter(self, name, pattern, **config):
        """
        @brief a filter is an endpoint that is applied on the current "collection kind" endpoint.
        """
        config['type']      = self.FILTER_ENDPOINT
        config['pattern']   = pattern
        return self.register_endpoint(name, **config)

    def register_redirect(self, name, target_endpoint, redirect_lookup=None, **config):
        """
        @brief a redirect endpoint is simply used for redirection.
        """
        config['type']              = self.REDIRECT_ENDPOINT
        config['target_endpoint']   = target_endpoint
        config['redirect_lookup']   = redirect_lookup or {}

        # when the new registered redirect should be performed depending on THIS
        # endpoints context, THIS endpoint needs to be initialized with a view_class
        if redirect_lookup:
            if not self.view_class:
                raise ImproperlyConfigured, ('a redirect endpoint ("%s") with lookup can not be ' % name) + \
                                            ('initialized on endpoint "%s", ' % self.get_absolute_name())+\
                                            'because therefore last one needs a view_class for get_object'
        return self.register_endpoint(name, **config)

    @property
    def url_patterns(self):
        """
        @brief url_patterns is a property that returns the url_patterns for this and all "child" endpoints.
        """
        urlpatterns=[]

        # prepare endpoint as URL
        endpoint_url, own_url = self.prepare_as_url()

        # register THIS endpoint
        if self.has_url():
            urlpatterns.append(
                own_url
            )


        # register depending endpoints
        for endpoint in self.list_endpoints():
            kwargs = {}
            if endpoint.namespace or endpoint.app_name:
                kwargs['namespace'] = endpoint.get_complete_namespace()
                kwargs['app_name'] = endpoint.app_name
                if kwargs['namespace'] is None:
                    del kwargs['namespace']
                if kwargs['app_name'] is None:
                    del kwargs['app_name']

            if endpoint.type is self.REDIRECT_ENDPOINT:
                redirect_url = '/'+ self.root.root_url + endpoint.target_endpoint.as_sitemap_url(absolute=True, python_formatting=True)

                lookups      = {}
                for lookup in lookups.items():
                    pass

                redirect_lookup = endpoint.redirect_lookup

                origin_view = None
                if redirect_lookup:
                    origin_view = self.view_class.as_view(dispatch=False)


                urlpatterns.append(
                    url(
                        endpoint_url,
                        RedirectView.as_view(
                            url=redirect_url,
                            permanent=endpoint.permanent_redirect,
                            query_string=endpoint.querystring_redirect,

                            origin_view = origin_view,
                            redirect_lookup = redirect_lookup
                        ))
                )
            else:
                endpoint_patterns = endpoint.url_patterns
                if endpoint_patterns:
                    urlpatterns.append(
                        url(
                            endpoint_url,
                            include(endpoint.url_patterns, **kwargs),
                            getattr(endpoint, 'include_kwargs', None)
                        )
                    )

        return patterns('', *urlpatterns) if urlpatterns else None

    def list_endpoints(self):
        """
        @brief this method is a generator, representing the list of endpoints that are registered as child of the current one.
        """
        raise Exception, 'to implement by subclass'

    def register(self, endpoint, **config):
        """
        @brief this method is a generator, representing the list of endpoints that are registered as child of the current one.
        """
        name = endpoint.name

        if endpoint.root:
            endpoint=copy.deepcopy(endpoint)


        endpoint.initialize(self.root, self if self.root is not self else None)


        self.root.register_view_name(endpoint.view_name, identifier=endpoint.get_complete_namespace(regular=True))

        # this way two endpoints can be named the same way,
        # but e.g. be different in their filter-pattern
        if not name in self._endpoints:
            self._endpoints[name] = []

        self._endpoints[name].append(endpoint)

        self._endpoint_registry[name] = self._endpoint_registry.get(name, config.pop('active', True))

        return self

    def _register_endpoint(self, name, **config):
        """
        @brief the actual registering of an endpoint is done here.
        TODO: register_endpoint might be obsolete
        """
        if self.type == self.REDIRECT_ENDPOINT:
            raise ImproperlyConfigured, 'redirect Endpoint "%s" can not register endpoints' % self.name

        if name in self._endpoints:
            if config.get('type') not in [self.FILTER_ENDPOINT, self.SELECTOR_ENDPOINT]:
                raise ImproperlyConfigured, 'endpoint "%s" found twice' % name
            if (any(endpoint.pattern == config.get('pattern') for endpoint in self._endpoints[name])):
                raise ImproperlyConfigured, 'filtered Endpoint "%s" with pattern "%s" found twice' % (self.name, config.get('pattern'))


        if type(config.get('view')) == type(ViewClass):
            config['view_class'] = config.pop('view')

        elif config.get('view_config'):
            view_config = config.get('view_config')
            view_model = view_config.get('model')
            endpoint_links = self.links
            api_root = self.root

            from . import serializers
            class AutoSerializer(serializers.ModelSerializer):
                _options_class = serializers.HyperlinkedModelSerializerOptions
                class Meta:
                    model       =   view_model

            class AutoView(view_config.get('base_view')):
                serializer_class = AutoSerializer
                model = view_model
                def get_response_headers(self, *args, **kwargs):
                    headers = super(AutoView, self).get_response_headers(*args, **kwargs)
                    for name, endpoint in endpoint_links.items():
                        link_name = name
                        link_url = '/' + api_root.as_url(absolute=True) + endpoint.as_sitemap_url(absolute=True, with_name=name) + '/'  # TODO: this slash - fix is ... - also: why isnt it absolute?!
                        if '{' not in link_url:
                            self.add_link_header(headers,
                                                  name=link_name,
                                                  url=link_url
                                                  )
                        else:
                            self.add_link_template_header(
                                    headers,
                                    name=link_name,
                                    url=link_url
                                    )
                    return headers

            AutoView.__name__ = view_model.__name__
            #AutoView.__doc__ = view_model.__doc__ #TODO

            config['view_class'] = AutoView

            if not hasattr(config['view_class'], 'filter_backends'):
                config['view_class'].filter_backends = ()
            config['view_class'].filter_backends += (EndpointFilterBackend, )

        endpoint = ApiEndpoint(
                        name=name,
                        **config
                    )

        self.register(endpoint, **config)

        return endpoint

    def prepare_as_url(self):
        """
        @returns tuple of ('endpoint_url', djangos url() definition).
        """
        raise Exception, 'to implement by subclass'

    def resolve_redirect(self, ):
        """
        TODO: is this being used? not really.
        """
        pass



class ApiEndpoint(ApiEndpointMixin):
    def __init__(self, name, **config):
        self.parent             = None
        self.root               = None
        self.name               = name
        self.pattern            = config.pop('pattern', None)
        self.kwargs             = config.pop('kwargs', None)# TODO default None?
        self.include_kwargs     = config.pop('include_kwargs', None)# TODO default None?

        self.view_name          = config.pop('view_name', None)
        self.view_class         = config.pop('view_class', None)
        self.view_config        = config.pop('view_config', {})
        self.view               = config.pop('view', None)

        self.target_endpoint    = config.pop('target_endpoint', None)
        self.redirect_lookup    = config.pop('redirect_lookup', None)
        self.permanent_redirect = config.pop('permanent_redirect', False)
        self.querystring_redirect=config.pop('querystring_redirect', True)
        self.apply_slash        = config.pop('apply_slash', True)

        self.lookup_fields      = config.pop('lookup_fields', {})
        self.depends_on         = config.pop('depends_on', {})

        self.config             = config

        super(ApiEndpoint, self).__init__(**config)

    def has_url(self, ):
        """
        @brief having an url, is the first condition for being represented in the url_patterns
        """
        return bool(self.view or self.view_class)

    def initialize(self, root, parent):
        """
        @brief an endpoint needs to get initialized for its specific parent and root.
        This allows to define an endpoint once and use it multiple times at several locations.
        """
        self.root       = root
        self.parent     = parent

        parent_field           = self.config.pop('parent_field', None)
        if parent_field:
            self.lookup_fields[self.parent] = parent_field

        if self.type in [self.FILTER_ENDPOINT, self.SELECTOR_ENDPOINT]:
            self.lookup_fields['self'] = lambda endpoint, request, *args, **kwargs: {endpoint.get_fitlers_field_name(): kwargs.get(endpoint.get_name(), None)}

        #user_field              = config.pop('user_field', None)
        #if user_field:
        #    self.lookup_fields['user'] = lambda endpoint, request, *args, **kwargs: {user_field: request.user if request.user.is_authenticated() else None}
        #
        #lookup_field = getattr(self.view_class, 'lookup_field', None)
        #if lookup_field:
        #    self.lookup_fields['self'] = lambda endpoint, request, *args, **kwargs: {lookup_field: kwargs.get(endpoint.name, None)}


        if not self.view:
            if not self.view_class:
                self.view_class = EndpointView
            if self.view_class:
                kwargs = {}
                kwargs['endpoint']  = self
                kwargs['config']    = self.view_config

                if self.type in [self.FILTER_ENDPOINT, self.SELECTOR_ENDPOINT]:
                    lookup_field = self.get_name()
                    if getattr(self.view_class, 'lookup_field', None) != lookup_field:
                        setattr(self.view_class, 'lookup_field', lookup_field)

                self.view           = self.view_class.as_view(**kwargs)

    def get_object_filter(self, request, *args, **kwargs):
        """
        @brief the object filter is being applied on a "collection" in order to receive a requested object.
        @returns a lookup dict, that is passed (**dict) as kwargs for djangos filter() method.
        """
        return self._get_object_data(request, args, kwargs, complete=True)

    def get_object_presets(self, request, *args, **kwargs):
        """
        used when updating new objects content by its endpoint position
        """
        return self._get_object_data(request, args, kwargs, complete=False)

    def _get_object_data(self, request, args, kwargs, complete=False):
        """
        @brief the object filter is being applied on a "collection" in order to receive a requested object.
        @returns a lookup dict, that is passed (**dict) as kwargs for djangos filter() method.
        """
        filter_kwargs = {}

        for endpoint, lookup_field in self.lookup_fields.items():

            if isinstance(endpoint, basestring):
                filter_kwargs.update(lookup_field(self, request, *args, **kwargs))
            else:
                for endpoint_lookup_field, endpoint_lookup_value in endpoint._get_object_data(request, args, kwargs, complete).iteritems():
                    lookup_field = '%s__%s' % (lookup_field, endpoint_lookup_field) if complete else lookup_field

                    filter_kwargs[lookup_field]    = endpoint_lookup_value

        return filter_kwargs

    def has_endpoints(self, ):
        """
        @returns if there are any active, registered endpoints
        """
        for name, is_active in self._endpoint_registry.iteritems():
            if is_active and name in self._endpoints:
                for endpoint in self._endpoints[name]:
                    return True
        return False

    def list_endpoints(self):
        for name, is_active in self._endpoint_registry.iteritems():
            if is_active and name in self._endpoints:
                for endpoint in self._endpoints[name]:
                    yield endpoint

    def as_url(self, absolute=False):
        """
        @returns the url, this endpoint is accessible with
        """
        if self.type in [self.FILTER_ENDPOINT, self.SELECTOR_ENDPOINT]:
            url = '(?P<%s>%s)' % (self.get_name(), self.pattern)
        elif self.type is None:
            url = '%s' % self.name
        elif self.type is self.REDIRECT_ENDPOINT:
            return self.target_endpoint.as_url(absolute=True)
        else:
            raise Exception, 'not implemented'

        if absolute:
            parent_url = (self.parent.as_url(absolute=True) + '/') if self.parent else ''
            return parent_url + url
        else:
            return url

    def prepare_as_url(self, ):
        own_url = self.as_url()

        kwargs = {}
        if self.view_name:
            kwargs['name'] = self.view_name

        endpoint_url = r'^{url}{slash}'.format(url=own_url, slash='/' if self.apply_slash else '')

        return endpoint_url, url(
                '%s$' % endpoint_url,
                self.view,
                self.kwargs,
                **kwargs
            )

    def get_fitlers_field_name(self, ):
        """
        @brief the filters field name is the field part of this endpoints name.
        if the endpoints name is not in the *model__field* syntax, it just returns the name
        """
        return self.name.split('__')[-1] if '__' in self.name else self.name

    def get_fitlers_object_name(self, ):
        """
        @brief the filters object name is the model part of this endpoints name.
        if the endpoints name is not in the *model__field* syntax, it just returns the name
        """
        return self.name.split('__')[0] if '__' in self.name else self.name

    def get_name(self, for_sitemap=False):
        """
        @returns the name for this endpoints, depending on its purpose
        @brief if the name should be used for the sitemap, it needs special formatting.
        """
        # TODO: should be used instead of .name
        # should be aware of type and react accordingly
        if not for_sitemap:
            return self.name
        return self.get_fitlers_object_name()


    def as_sitemap_url(self, absolute=False, python_formatting=False, with_name=None):
        """
        @returns the sitemap url string
        @brief the sitemap urls might contain {vars} when in the sitemap.json or (vars)%s for django urls (python formatting)
        """
        if self.type in [self.FILTER_ENDPOINT, self.SELECTOR_ENDPOINT]:

            if not python_formatting:
                # href - LINK Template formatting
                url = '{%s}' % (with_name or self.get_fitlers_field_name())
                    #self.get_name(for_sitemap=True)
            else:
                url = '%(' + ('%s)s' % (with_name or self.name))
        elif self.type is None:
            url = '%s' % (with_name or self.name)
        elif self.type is self.REDIRECT_ENDPOINT:
            #absolute=False
            #url = self.target_endpoint.as_sitemap_url(absolute=True)
            url = '%s' % (with_name or self.name)
        else:
            raise Exception, 'not implemented'

        if absolute:
            parent_url = (self.parent.as_sitemap_url(absolute=True) + '/') if self.parent else ''
            return parent_url + url
        else:
            return url

    def as_sitemap(self, url_path=''):
        """
        @returns this endpoint and all children as sitemap
        """
        current_url = None
        if self.has_url():
            current_url = self.as_sitemap_url(absolute=True) + '/'

        elif not self.has_endpoints():
            pass#return None
            #raise Exception, 'an "empty endpoint" (no url) is required to have children endpoints'

        sitemap = {}
        if current_url:
            sitemap['.'] = current_url

        for endpoint in self.list_endpoints():
            if endpoint.is_active():
                endpoint_sitemap = endpoint.as_sitemap()
                if endpoint_sitemap is not None:
                    sitemap[endpoint.get_name(for_sitemap=True)] = endpoint_sitemap

        return sitemap or None

    def is_active(self, endpoint=None):
        """
        @brief if an endpoint is not active, it is not propagated at all.
        """
        if endpoint:
            # if the child was explicitly deactivated
            if not self._endpoint_registry.get(endpoint.name, False):
                return False

        # else check those, this depends on

        # if its a redirect, check the target
        if self.type == self.REDIRECT_ENDPOINT:
            if not self.target_endpoint.is_active():
                return False

        # check if direct parents are active
        return (self.parent or self.root).is_active(self)



class APIRoot(ApiEndpointMixin, APIView):
    """
    @brief the APIRoot is a special endpoint, as it provides some built-in actions like "getCredentials" or "getSitemap".
    It also keeps track on all view_names that are being registered.
    """
    def __init__(self, **config):
        self._view_names        = {}

        self.root               = self
        self.parent             = None

        self.root_url           = api_settings.API_URL

        super(APIRoot, self).__init__(**config)

        #self.namespace          = self.namespace or 'api'
        #self.app_name           = self.app_name or 'api'

        self.type               = self.type or self.ROOT_ENDPOINT

        self.statics_config     = {
            'js':{
                'paths':[
                    {'name':"json", 'location': "../lib/json2"},
                    {'name':"jquery", 'location': "../lib/jquery"},
                    {'name':"introspective-api-endpoint", 'location': "../lib/introspective_api.endpoint"},
                    {'name':"introspective-api-client", 'location': "../lib/introspective_api.client"},
                    {'name':"introspective-api-object", 'location': "../lib/introspective_api.object"},
                ],
                'packages':[
                    {
                        'name': 'hawk',
                        'main': 'hawk',
                        'location': '../lib',
                    }
                ]
            }
        }

    def as_url(self, absolute=False, **kwargs):
        return self.root_url
    
    """
    def post(self, request, *args, **kwargs):
        action = request.DATA.get('action', None)

        if action == 'getCredentials':
            credentials_view    = api_settings.API_CREDENTIALS_VIEW
            return credentials_view(request, *args, **kwargs)

        elif action == 'revalidateCredentials':
            credentials_view    = api_settings.API_CREDENTIALS_VIEW
            return credentials_view(request, *args, **kwargs)

        elif action == 'getSitemap':
            version = request.DATA.get('version', '1.0')
            return ApiResponse(
                api_root.generate_sitemap(version)
            )

    def get(self, request, *args, **kwargs):

        version = request.GET.get('version', '1.0')
        return ApiResponse(
            api_root.generate_sitemap(version)
        )
    """
    def get_complete_namespace(self, *args, **kwargs):
        return 'api'
    
    def get_complete_app_name(self, *args, **kwargs):
        return 'api'

    def options(self, request, *args, **kwargs):
        version = request.GET.get('version', '1.0')

        ret = super(APIRoot, self).options(request, *args, **kwargs)
        ret = ret.data

        ret.update(api_root.generate_sitemap(version))
        #ret['sitemap'] = api_root.generate_sitemap(version)

        return ApiResponse(
            ret
        )

    def has_url(self, ):
        return True

    def register_view_name(self, view_name=None, identifier=None):
        """
        @brief reigsters a view_name and ensures there is no existing view in this namespace registered with this name
        """
        if not view_name:
            return

        if not identifier in self._view_names:
            self._view_names[identifier] = []

        elif view_name in self._view_names[identifier]:
            raise ImproperlyConfigured, 'view_name "%s" found twice in namespace "%s"' % (view_name, identifier)

        self._view_names[identifier].append(view_name)

    def register(self, endpoint, **config):
        config['active'] = config.get('active', bool(config.get('view_name', None)))
        return super(APIRoot, self).register(endpoint, **config)

    def is_active(self, endpoint=None):
        if endpoint:
            if not self._endpoint_registry.get(endpoint.name, False):
                return False

        return True # root is allways active

    def has_endpoints(self):
        # copy list to be sure its not changed
        for name, is_active in self._endpoint_registry.iteritems():
            if is_active and name in self._endpoints:
                return True

    def list_endpoints(self):
        for name, is_active in self._endpoint_registry.iteritems():
            if is_active and name in self._endpoints:
                for endpoint in self._endpoints[name]:
                    yield endpoint

    def prepare_as_url(self):
        if self.root_url:
            endpoint_url = '^%s' % self.root_url
        else:
            endpoint_url = ''

        return endpoint_url, url(
            '^%s$' % self.root_url,
            self.__class__.as_view(),
            name=api_settings.API_ROOT_NAME
        )

    def generate_sitemap(self, version):
        sitemap = {
            'version': version,
            'links': {}
        }

        if self.has_endpoints():
            for endpoint in self.list_endpoints():
                if endpoint.is_active():
                    endpoint_sitemap = endpoint.as_sitemap()
                    if endpoint_sitemap is not None:
                        sitemap['links'][endpoint.name] = endpoint_sitemap
        else:
            return {}


        return sitemap

    def get_static_endpoints(self, ):
        """
        @returns a generator of all static endpoint configurations. if None was registered, it returns a default endpoint
        """
        return [
                    {
                        'url': self.root_url,
                        'js': {
                            'var_name': 'api',
                            'file_name': 'api.js',
                            'requirements': {
                                'jquery': None,
                                'endpoint': None,
                                },
                            'is_cross_domain': False
                        }
                    }
                ]

    def register_js_resource(self, name_or_package, value=None):
        """
        @brief here the static_config can be manipulated
        """
        if value is None:
            # name contains a package
            self.statics_config['js']['packages'].append(name_or_package)
        else:
            self.statics_config['js']['paths'][name_or_package] = value

    def get_statics_config(self, ):
        """
        @returns the config for static files generation
        """
        return {
                    'js':         self.statics_config['js'],
                    'endpoints':  self.get_static_endpoints()
                }


api_root = APIRoot()
get_statics_config = api_root.get_statics_config

###


#if len(kwargs.keys()) == 0:
#    if len(args) == 1 and callable(args[0]):
#        # e.g. @register.***
#        kwargs["view"]    =   args[0]
#        ret_func          =     True
#    else:
#        raise InvalidDynamicContent("""view argument missing""")
#
#el
#if  name or len(kwargs.keys()):
"""
if settings.DEBUG:
    _url = re.sub("\(([:\[\]\?\*\.\-a-zA-Z0-9\<\>\\\_]*)\)", '***', endpoint_url)
    if _url not in seen:
        seen.append(_url)
    if _url in missing:
        del missing[missing.index(_url)]

    __url_parts = []
    for __url in _url.split('/'):
        __url_parts.append(__url)
        __url_beginning = '/'.join(__url_parts)
        if __url_beginning in missing:
                continue
        if __url_beginning not in seen:
                missing.append(__url_beginning)
"""

"""
if settings.DEBUG:
    import sys
    if missing:
        sys.stderr.write('WARNING: missing endpoints:\n')
    for _url in missing:
        endpoint_url = re.sub('\*\*\*', "([:\.\-a-zA-Z0-9\<\>\\\_]*)", _url)
        urlpatterns.append(
                url(
                    r'^{url}/$'.format(url=endpoint_url),
                    Empty.as_view()
                )
            )
        sys.stderr.write(self.url_prefix+endpoint_url+'\n')
"""