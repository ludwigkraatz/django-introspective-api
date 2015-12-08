from rest_framework.views import APIView
from django.views.generic import RedirectView
from rest_framework import status
from introspective_api.settings import api_settings
from introspective_api.fields import HyperlinkedMetaField, HyperlinkedIdentityField
from introspective_api.fields import NoReverseMatch, ResolveError
from django.core.exceptions import ValidationError
from functools import update_wrapper
from django.views.decorators.csrf import csrf_exempt

ApiResponse = api_settings.API_RESPONSE_CLASS


def add_query_args(url, query_dict):
    for key, value in query_dict.items():
        url += ('?' if '?' not in url else '&') + key + '=' + value
    return url


class APIView(APIView):
    settings = api_settings
    endpoint = None
    config = None

    def get_handler_for(self, request, *args, **kwargs):
        if request.method.lower() in self.http_method_names:
            handler = getattr(self, request.method.lower(),
                              self.http_method_not_allowed)
        else:
            handler = self.http_method_not_allowed
        return handler

    # Note: session based authentication is explicitly CSRF validated,
    # all other authentication is CSRF exempt.
    @csrf_exempt
    def dispatch(self, request, *args, **kwargs):
        """
        `.dispatch()` is pretty much the same as Django's regular dispatch,
        but with extra hooks for startup, finalize, and exception handling.
        """
        self.args = args
        self.kwargs = kwargs
        request = self.initialize_request(request, *args, **kwargs)
        self.request = request
        self.headers = self.default_response_headers  # deprecate?

        try:
            self.initial(request, *args, **kwargs)

            # Get the appropriate handler method
            handler = self.get_handler_for(request, *args, **kwargs)

            response = handler(request, *args, **kwargs)

        except Exception as exc:
            response = self.handle_exception(exc)

        self.response = self.finalize_response(request, response, *args, **kwargs)
        return self.response

    def get_config(self):
        return self.config or {}


    #def get_format_suffix(self, **kwargs):
    #    """
    #    Determine if the request includes a '.json' style format suffix
    #    """
    #    if self.settings.FORMAT_SUFFIX_KWARG:
    #        return kwargs.pop(self.settings.FORMAT_SUFFIX_KWARG, getattr(self, 'format_kwarg', None))
    #    return None

    @classmethod
    def as_view(cls, dispatch=True, **initkwargs):
        """
        Main entry point for a request-response process.
        """
        # sanitize keyword arguments
        for key in initkwargs:
            if key in cls.http_method_names:
                raise TypeError("You tried to pass in the %s method name as a "
                                "keyword argument to %s(). Don't do that."
                                % (key, cls.__name__))
            if not hasattr(cls, key):
                raise TypeError("%s() received an invalid keyword %r. as_view "
                                "only accepts arguments that are already "
                                "attributes of the class." % (cls.__name__, key))

        def view(request, *args, **kwargs):
            self = cls(**initkwargs)
            if hasattr(self, 'get') and not hasattr(self, 'head'):
                self.head = self.get
            self.request = request
            #setattr(request, 'endpoint', getattr(self, 'endpoint', None))

            self.args = args
            self.kwargs = kwargs
            if dispatch:
                return self.dispatch(request, *args, **kwargs)
            else:
                return self

        # take name and docstring from class
        update_wrapper(view, cls, updated=())

        # and possible attributes set by decorators
        # like csrf_exempt from dispatch
        update_wrapper(view, cls.dispatch, assigned=())
        return view


    # see http://tools.ietf.org/html/rfc5988
    reserved_link_relations = ['alternate', 'appendix', 'bookmark', 'chapter', 'contents', 'copyright', 'current',
                             'describedby', 'edit', 'edit-media', 'enclosure', 'first', 'glossary', 'help', 'hub',
                             'index', 'last', 'latest-version', 'license', 'next', 'next-archive', 'payment',
                             'prev', 'predecessor-version', 'previous', 'prev-archive', 'related', 'replies',
                             'section', 'self', 'service', 'start', 'stylesheet', 'subsection', 'successor-version',
                             'up', 'version-history', 'via', 'working-copy', 'working-copy-of',
                             # and https://tools.ietf.org/html/rfc6903
                             'terms-of-service', 'about', 'preview', 'privacy-policy', 'type',
                             # TODO: and not yet registered (http://tools.ietf.org/html/rfc5988#page-11):
                             'action', 'auth']

    def get_response_headers(self, request, status_code=None, serializer=None, object=None, serializer_class=None, **kwargs):
        status_code = status_code or status.HTTP_200_OK
        serializer_class = serializer.__class__ if serializer else (serializer_class or (self.get_serializer_class() if hasattr(self, 'get_serializer_class') else None))
        headers = super(APIView,self).get_response_headers(request, status_code, serializer=serializer, object=object, **kwargs)

        #serializer = serializer or serializer_class()

        if serializer is None and serializer_class is not None:
            serializer = serializer_class()

        if status_code == status.HTTP_200_OK:
            if serializer and serializer.object:
                if isinstance(serializer.data, (tuple,list)):
                    for name, field in serializer.get_meta_fields().iteritems():
                        link_name = self.get_header_link_name_from_field(field, name)
                        uri = serializer.field_to_template(field, name)
                        self.add_link_template_header(headers,
                                                      name=link_name,
                                                      uri=uri
                                                      )
                elif isinstance(serializer.data, dict):
                    meta_fields = serializer.get_meta_fields()
                    contentURL = self.getContentURL(meta_fields, serializer.object)

                    for name, field in meta_fields.iteritems():
                        link_name = self.get_header_link_name_from_field(field, name)
                        try:
                            if link_name != 'self':
                                uri = field.field_to_native(serializer.object, name)
                                self.add_link_header(headers,
                                                      name=link_name,
                                                      uri=uri
                                                      )
                            else:
                                self.add_link_header(headers,
                                                      name=link_name,
                                                      url=contentURL
                                                      )  # TODO: really adding the self header? isnt this redundant with Content-Location (which is more important)?

                        except ValidationError: #TODO ugly workaround..
                            raise
                            uri = serializer.field_to_template(field, name)
                            self.add_link_template_header(
                                    headers,
                                    name=link_name,
                                    uri=uri
                                    )

                # TODO: the content-location might also be usefull to set for Lists
                    if request.get_full_path() != contentURL:
                        # why Content-Location:
                        # http://tools.ietf.org/html/rfc2616#section-14.14
                        headers['Content-Location'] = contentURL

            elif serializer or serializer_class:
                # TODO: evaluate / test
                for name, field in (serializer or serializer_class()).get_meta_fields().iteritems():
                    link_name = self.get_header_link_name_from_field(field, name)
                    try:
                        obj = (serializer.object if serializer else None) or object
                        if obj is None:
                            raise ResolveError()

                        uri = field.field_to_native(obj, name)
                        self.add_link_header(headers,
                                                  name=link_name,
                                                  uri=uri
                                                  )
                    except ResolveError:  # , NoReverseMatch:
                        uri = serializer.field_to_template(field, name)#, include_pattern=False)
                        self.add_link_template_header(headers,
                                                  name=link_name,
                                                  uri=uri
                                                  )

        return headers

    def getContentURL(self, meta_fields=None, object=None):
        if not hasattr(self, '_currentContentURL') and not meta_fields:
            return self.request.build_absolute_uri()
        if meta_fields and object:
            for name, field in meta_fields.iteritems():
                link_name = self.get_header_link_name_from_field(field, name)
                if link_name == 'self':
                    uri = field.field_to_native(object, name)
                    setattr(self, '_currentContentURL', self.prepare_uri_for_header(uri))
                    break
        return getattr(self, '_currentContentURL')

    def get_header_link_name_from_field(self, field, name):
        if isinstance(field, HyperlinkedIdentityField):
            return 'self'
        return name

    @property
    def currentLinkQueryKwargs(self, ):
        if not hasattr(self, '_linkQueryKwargs'):
            additional_query_args = {}
            for key, value in self.request.GET.items():
                if key in getattr(self, 'keep_query_args_for_links', {}):
                    additional_query_args[key] = value
            setattr(self, '_linkQueryKwargs', additional_query_args)
        return getattr(self, '_linkQueryKwargs')

    def prepare_uri_for_header(self, uri, uri_prefix=None, query_lookup=None):
        request = self.request
        additional_query_args = self.currentLinkQueryKwargs

        if not uri_prefix and '://' not in uri:
            uri_prefix = request.build_absolute_uri('' if not uri.startswith('/') else '/')
            if uri.startswith('/'):
                uri_prefix = uri_prefix[:-1]
        else:
            uri_prefix = uri_prefix or ''
        if '?' in uri_prefix:
            uri_prefix, _ = uri_prefix.split('?')

        url = uri_prefix + uri
        if query_lookup:
            url = add_query_args(url, query_lookup)
        return add_query_args(
            url,
            additional_query_args
        ) if '?' not in uri else url

    # see http://tools.ietf.org/html/draft-nottingham-link-template-00
    def add_link_template_header(self, headers, name, uri=None, url=None, rel=None, uri_prefix=None, query_lookup=None):
        url = url or self.prepare_uri_for_header(uri, uri_prefix=uri_prefix, query_lookup=query_lookup)
        if not 'Link-Template' in headers:
            headers['Link-Template'] = ''
        else:
            headers['Link-Template'] += ', '
        if rel is None and name in self.reserved_link_relations:
            headers['Link-Template'] += '<{url}>; rel="{name}"'.format(url=url, name=name)
        else:
            headers['Link-Template'] += '<{url}>; rel="{rel}"; title="{name}"'.format(url=url, name=name, rel=rel or 'related')

    # see http://tools.ietf.org/html/rfc5988
    def add_link_header(self, headers, name, uri=None, url=None, rel=None, uri_prefix=None, query_lookup=None):
        url = url or self.prepare_uri_for_header(uri, uri_prefix=uri_prefix, query_lookup=query_lookup)
        if not 'Link' in headers:
            headers['Link'] = ''
        else:
            headers['Link'] += ', '
        if rel is None and name in self.reserved_link_relations:
            headers['Link'] += '<{url}>; rel="{name}"'.format(url=url, name=name)
        else:
            headers['Link'] += '<{url}>; rel="{rel}"; title="{name}"'.format(url=url, name=name, rel=rel or 'related')

    def options(self, request, *args, **kwargs):
        """
        Handler method for HTTP 'OPTIONS' request.
        We may as well implement this as Django will otherwise provide
        a less useful default implementation.
        """
        headers = self.get_response_headers(request=request)#,object=instance|list)
        return ApiResponse(self.metadata(request=request), status=status.HTTP_200_OK, headers=headers).finalize_for(request)

class EndpointView(APIView):

    def options2(self, request, *args, **kwargs):
        """
        Handler method for HTTP 'OPTIONS' request.
        We may as well implement this as Django will otherwise provide
        a less useful default implementation.
        """
        headers = self.get_response_headers(request)#, None, serialier, objectClass)
        return Response(self.metadata(request), status=status.HTTP_200_OK, headers=headers)

class RedirectView(APIView, RedirectView):
    origin_view = None
    redirect_lookup = None
    lookup_object = None

    def get_redirect_url(self, **kwargs):
        if self.lookup_object:
            for key, value in self.redirect_lookup.items():
                value = getattr(self.lookup_object, value)
                if callable(value):
                    value = value()
                kwargs[key] = str(value)

        return super(RedirectView, self).get_redirect_url(**kwargs)

    def get(self, request, *args, **kwargs):
        if self.redirect_lookup and self.origin_view:
            self.lookup_object = self.origin_view(request, *args, **kwargs).get_object()
        return super(RedirectView, self).get(request, *args, **kwargs)
