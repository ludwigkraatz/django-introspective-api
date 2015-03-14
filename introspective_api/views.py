from rest_framework.views import APIView
from django.views.generic import RedirectView
from rest_framework import status
from introspective_api.settings import api_settings
from introspective_api.fields import HyperlinkedMetaField, HyperlinkedIdentityField
from django.core.exceptions import ValidationError
from functools import update_wrapper
from django.views.decorators.csrf import csrf_exempt

ApiResponse = api_settings.API_RESPONSE_CLASS

class APIView(APIView):
    settings = api_settings
    endpoint = None
    config = None

    @csrf_exempt
    def dispatch(self, *args, **kwargs):
        return super(APIView, self).dispatch(*args, **kwargs)

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
                             'up', 'version-history', 'via', 'working-copy', 'working-copy-of']

    def get_response_headers(self, request, status_code=None, serializer=None, object=None, **kwargs):
        status_code = status_code or status.HTTP_200_OK
        headers = super(APIView,self).get_response_headers(request, status_code, serializer=serializer, object=object, **kwargs)

        if serializer is None and getattr(self, 'serializer_class', None) is not None:
            serializer = getattr(self, 'serializer_class')()
        if status_code == status.HTTP_200_OK:
            if serializer and serializer.object:
                if isinstance(serializer.data, (tuple,list)):
                    for name, field in serializer.get_meta_fields().iteritems():
                        link_name = self.get_header_link_name_from_field(field, name)
                        self.add_link_template_header(headers,
                                                      name=link_name,
                                                      url=request.build_absolute_uri('/')+serializer.field_to_template(field, name)
                                                      )
                elif isinstance(serializer.data, dict):
                    for name, field in serializer.get_meta_fields().iteritems():
                        link_name = self.get_header_link_name_from_field(field, name)
                        try:
                            if name != 'self':
                                self.add_link_header(headers,
                                                      name=link_name,
                                                      url=field.field_to_native(serializer.object, name)
                                                      )
                            else:
                                url = field.field_to_native(serializer.object, name)
                                if request.get_full_path() != url:
                                    # why Content-Location:
                                    # http://tools.ietf.org/html/rfc2616#section-14.14
                                    headers['Content-Location'] = url
                        except ValidationError: #TODO ugly workaround..
                            raise
                            self.add_link_template_header(
                                    headers,
                                    name=link_name,
                                    url=request.build_absolute_uri('/')+serializer.field_to_template(field, name)
                                    )
            elif serializer:
                # TODO: evaluate / test
                for name, field in serializer.get_meta_fields().iteritems():
                    link_name = self.get_header_link_name_from_field(field, name)
                    self.add_link_template_header(headers,
                                                  name=link_name,
                                                  url=request.build_absolute_uri('/')+serializer.field_to_template(field, name)
                                                  )

        return headers

    def get_header_link_name_from_field(self, field, name):
        if isinstance(field, HyperlinkedIdentityField):
            return 'self'
        return name

    # see http://tools.ietf.org/html/draft-nottingham-link-template-00
    def add_link_template_header(self, headers, name, url, rel=None):
        if not 'Link-Template' in headers:
            headers['Link-Template'] = ''
        else:
            headers['Link-Template'] += ', '
        if rel is None and name in self.reserved_link_relations:
            headers['Link-Template'] += '<{url}>; rel="{name}"'.format(url=url, name=name)
        else:
            headers['Link-Template'] += '<{url}>; rel="{rel}"; title="{name}"'.format(url=url, name=name, rel=rel or 'related')

    # see http://tools.ietf.org/html/rfc5988
    def add_link_header(self, headers, name, url, rel=None):
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
        headers = self.get_response_headers(request)#, None, serialier, objectClass)
        return ApiResponse(self.metadata(request), status=status.HTTP_200_OK, headers=headers).finalize_for(request)

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

        return super(Redirect, self).get_redirect_url(**kwargs)

    def get(self, request, *args, **kwargs):
        if self.redirect_lookup and self.origin_view:
            self.lookup_object = self.origin_view(request, *args, **kwargs).get_object()
        return super(Redirect, self).get(request, *args, **kwargs)