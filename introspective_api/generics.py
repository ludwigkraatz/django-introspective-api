"""
Generic views that provide commonly needed behaviour.
"""
from __future__ import unicode_literals
from functools import partial

from django.core.exceptions import ImproperlyConfigured, PermissionDenied, MultipleObjectsReturned
from django.core.paginator import Paginator, InvalidPage
from django.http import Http404
from django.shortcuts import get_object_or_404 as _get_object_or_404
from django.utils.translation import ugettext as _
from rest_framework import views, mixins, exceptions
from rest_framework.request import clone_request
from rest_framework.response import Response
import warnings

from introspective_api.settings import api_settings
from introspective_api import views, mixins, renderers


def get_object_or_404(queryset, **filter_kwargs):
    """
    Same as Django's standard shortcut, but make sure to raise 404
    if the filter_kwargs don't match the required types.
    """
    try:
        return _get_object_or_404(queryset, **filter_kwargs)
    except (TypeError, ValueError):
        raise Http404


class ActionView(views.APIView):
    #def post(self, *args, **kwargs):
    #    # TODO: this isnt very nice.
    #    # this only executes, if its NOT an action. but its needed if the ActionMixin is the only mixin, to allow POST methods
    #    raise Exception('Programming Error: this shouldnt happen')  # TODO

    def get_actions(self, request, instance=None, list_all=False, *args, **kwargs):
        # {action: {handler: lambda ResponseClass: ResponseClass(), ResponseClass: None}}
        return {}

    def get_action_config(self, request, action):
        try:
            return self.get_actions(request, list_all=True)[action]
        except KeyError:
            raise  # TODO

    def execute(self, request, action, *args, **kwargs):
        if action not in self.get_actions(request, list_all=True):
            return self.http_method_not_allowed(request, *args, **kwargs)

        config = self.get_action_config(request, action)
        handler = config.get('handler')
        ResponseClass = config.get('ResponseClass', api_settings.API_RESPONSE_CLASS)
        response = handler(
            request=request,
            *args,
            action=action,
            ResponseClass=ResponseClass,
            view=self,
            **kwargs
        )
        if not isinstance(response, (Response, ResponseClass)):
            response = ResponseClass(response)#.finalize_for(request)
        for header, value in self.get_response_headers(request, *args, **kwargs).items():
            response[header] = value

        return response

    def get_handler_for(self, request, *args, **kwargs):
        if request.method.upper() == 'POST' and 'action' in request.GET:
            return partial(self.execute, action=request.GET['action'])  #(request, request.GET['action'], *args, **kwargs)
        return super(ActionView, self).get_handler_for(request, *args, **kwargs)

    def metadata(self, request, defaults=None):
        """
        """
        if not isinstance(defaults, dict):
            defaults = {}
        action = request.GET.get('action', None)
        ret = super(ActionView, self).metadata(request)
        defaults.update(ret)

        if action is None:

            actions = {}

            for name, action in self.get_actions(request).items():
                options = action.get('options', {})
                actions[name] = options if not callable(options) else options(request=request, action=name, view=self, defaults=defaults)

            if actions:
                defaults['actions'] = actions
        else:
            ret = self.get_action_config(request, action).get('options', {})
            ret = ret if not callable(ret) else ret(request=request, action=action, view=self, defaults=defaults)
            defaults['actions'] = {'POST': ret}
        return defaults

    def get_response_headers(self, request, status_code=None, serializer=None, object=None, serializer_class=None, **kwargs):
        serializer_class = serializer.__class__ if serializer else (serializer_class or (self.get_serializer_class() if hasattr(self, 'get_serializer_class') else None))
        headers = super(ActionView,self).get_response_headers(request, status_code, serializer=serializer, object=object, **kwargs)

        action = request.GET.get('action', None) if request.method in ['POST', 'OPTIONS'] else None
        for name, config in self.get_actions(request, instance=object or (serializer.object if serializer else None), list_all=True).items():
            #self.add_link_template_header(headers,
            #                              name=link_name,
            #                              uri=uri,
            #                              rel='action'
            #                              )
            self.add_link_header(headers,
                                  name=name,
                                  query_lookup={'action': name},
                                  rel='action',
                                  uri=''
                                  )
            if action == name:
                if 'links' in config:
                    for name, value in config['links'].items():
                        url = None
                        uri = None
                        rel = None
                        query_lookup = None
                        if isinstance(value, basestring):
                            uri = value
                        else:
                            if value['as_query']:
                                query_lookup = {'action': action}
                                query_lookup[name] = value['as_query'] if value['as_query'] is not True else None
                                uri = ''
                            rel = value.get('rel', rel)
                            uri = value.get('uri', uri)
                            url = value.get('url', url)
                        self.add_link_header(headers,
                                      name=name,
                                      query_lookup=query_lookup,
                                      rel=rel,
                                      uri=uri,
                                      url=url
                                      )

                if 'link_templates' in config:
                    for name, value in config['link_templates'].items():
                        url = None
                        uri = None
                        rel = None
                        query_lookup = None
                        if isinstance(value, basestring):
                            uri = value
                        else:
                            if value['as_query']:
                                query_lookup = {'action': action}
                                query_lookup[name] = value['as_query'] if value['as_query'] is not True else ('{' + name + '}')
                                uri = ''
                            rel = value.get('rel', rel)
                            uri = value.get('uri', uri)
                            url = value.get('url', url)
                        self.add_link_template_header(headers,
                                          name=name,
                                          query_lookup=query_lookup,
                                            rel=rel,
                                            uri=uri,
                                            url=url
                                          )

        return headers


class GenericAPIView(ActionView):
    """
    Base class for all other generic views.
    """

    # You'll need to either set these attributes,
    # or override `get_queryset()`/`get_serializer_class()`.
    queryset = None
    serializer_class = None

    # This shortcut may be used instead of setting either or both
    # of the `queryset`/`serializer_class` attributes, although using
    # the explicit style is generally preferred.
    model = None

    # If you want to use object lookups other than pk, set this attribute.
    # For more complex lookup requirements override `get_object()`.
    lookup_field = 'pk'

    # Pagination settings
    paginate_by = api_settings.PAGINATE_BY
    paginate_by_param = api_settings.PAGINATE_BY_PARAM
    pagination_serializer_class = api_settings.DEFAULT_PAGINATION_SERIALIZER_CLASS
    page_kwarg = 'page'

    # The filter backend classes to use for queryset filtering
    filter_backends = api_settings.DEFAULT_FILTER_BACKENDS
    use_endpoint_filter = True

    # The following attributes may be subject to change,
    # and should be considered private API.
    model_serializer_class = api_settings.DEFAULT_MODEL_SERIALIZER_CLASS
    paginator_class = Paginator

    ######################################
    # These are pending deprecation...

    pk_url_kwarg = 'pk'
    slug_url_kwarg = 'slug'
    slug_field = 'slug'
    allow_empty = True
    filter_backend = api_settings.FILTER_BACKEND

    def get_actions(self, request, *args, **kwargs):
        actions = None
        if self.model and hasattr(self.model, 'get_api_actions'):
            try:
                instance = self.get_object()
            except:
                instance = None
            actions = self.model.get_api_actions(request=request, instance=instance, *args, **kwargs)
        return actions or super(GenericAPIView, self).get_actions(request, *args, **kwargs)

    def get_serializer_context(self):
        """
        Extra context provided to the serializer class.
        """
        return {
            'request': self.request,
            'format': self.format_kwarg,
            'view': self
        }

    def get_serializer(self, instance=None, data=None,
                       files=None, many=False, partial=False):
        """
        Return the serializer instance that should be used for validating and
        deserializing input, and for serializing output.
        """
        if instance and data:
            # we're update the obj with passed data
            partial = True
        if data:
            # we're creating the obj with passed data
            if hasattr(self, '_me_creating__object_name'):
                if self._me_creating__object_name == "self":
                    data["id"] = self.request.user.pk
                else:
                    data[self._me_creating__object_name] = self.request.user.pk

        serializer_class = self.get_serializer_class()
        context = self.get_serializer_context()
        return serializer_class(instance, data=data, files=files,
                                many=many, partial=partial, context=context)

    def get_pagination_serializer(self, page):
        """
        Return a serializer instance to use with paginated data.
        """
        class SerializerClass(self.pagination_serializer_class):
            class Meta(self.pagination_serializer_class.Meta):
                object_serializer_class = self.get_serializer_class()

        pagination_serializer_class = SerializerClass
        context = self.get_serializer_context()
        return pagination_serializer_class(instance=page, context=context)

    def paginate_queryset(self, queryset, page_size=None):
        """
        Paginate a queryset if required, either returning a page object,
        or `None` if pagination is not configured for this view.
        """
        deprecated_style = False
        if page_size is not None:
            warnings.warn('The `page_size` parameter to `paginate_queryset()` '
                          'is due to be deprecated. '
                          'Note that the return style of this method is also '
                          'changed, and will simply return a page object '
                          'when called without a `page_size` argument.',
                          PendingDeprecationWarning, stacklevel=2)
            deprecated_style = True
        else:
            # Determine the required page size.
            # If pagination is not configured, simply return None.
            page_size = self.get_paginate_by()
            if not page_size:
                return None

        if not self.allow_empty:
            warnings.warn(
                'The `allow_empty` parameter is due to be deprecated. '
                'To use `allow_empty=False` style behavior, You should override '
                '`get_queryset()` and explicitly raise a 404 on empty querysets.',
                PendingDeprecationWarning, stacklevel=2
            )

        paginator = self.paginator_class(queryset, page_size,
                                         allow_empty_first_page=self.allow_empty)
        page_kwarg = self.kwargs.get(self.page_kwarg)
        page_query_param = self.request.QUERY_PARAMS.get(self.page_kwarg)
        page = page_kwarg or page_query_param or 1
        try:
            page_number = int(page)
        except ValueError:
            if page == 'last':
                page_number = paginator.num_pages
            else:
                raise Http404(_("Page is not 'last', nor can it be converted to an int."))
        try:
            page = paginator.page(page_number)
        except InvalidPage as e:
            raise Http404(_('Invalid page (%(page_number)s): %(message)s') % {
                                'page_number': page_number,
                                'message': str(e)
            })

        if deprecated_style:
            return (paginator, page, page.object_list, page.has_other_pages())
        return page

    def filter_queryset(self, queryset):
        """
        Given a queryset, filter it with whichever filter backend is in use.

        You are unlikely to want to override this method, although you may need
        to call it either from a list view, or from a custom `get_object`
        method if you want to apply the configured filtering backend to the
        default queryset.
        """
        filter_backends = self.filter_backends or []
        if not filter_backends and self.filter_backend:
            warnings.warn(
                'The `filter_backend` attribute and `FILTER_BACKEND` setting '
                'are due to be deprecated in favor of a `filter_backends` '
                'attribute and `DEFAULT_FILTER_BACKENDS` setting, that take '
                'a *list* of filter backend classes.',
                PendingDeprecationWarning, stacklevel=2
            )
            filter_backends = [self.filter_backend]

        for backend in filter_backends:
            queryset = backend().filter_queryset(self.request, queryset, self)
        return queryset

    ########################
    ### The following methods provide default implementations
    ### that you may want to override for more complex cases.

    def get_paginate_by(self, queryset=None):
        """
        Return the size of pages to use with pagination.

        If `PAGINATE_BY_PARAM` is set it will attempt to get the page size
        from a named query parameter in the url, eg. ?page_size=100

        Otherwise defaults to using `self.paginate_by`.
        """
        if queryset is not None:
            warnings.warn('The `queryset` parameter to `get_paginate_by()` '
                          'is due to be deprecated.',
                          PendingDeprecationWarning, stacklevel=2)

        if self.paginate_by_param:
            query_params = self.request.QUERY_PARAMS
            try:
                return int(query_params[self.paginate_by_param])
            except (KeyError, ValueError):
                pass

        return self.paginate_by

    def get_serializer_class(self):
        """
        Return the class to use for the serializer.
        Defaults to using `self.serializer_class`.

        You may want to override this if you need to provide different
        serializations depending on the incoming request.

        (Eg. admins get full serialization, others get basic serialization)
        """
        serializer_class = self.serializer_class
        if serializer_class is not None:
            return serializer_class

        assert self.model is not None, \
            "'%s' should either include a 'serializer_class' attribute, " \
            "or use the 'model' attribute as a shortcut for " \
            "automatically generating a serializer class." \
            % self.__class__.__name__

        class DefaultSerializer(self.model_serializer_class):
            class Meta(self.model_serializer_class.Meta):
                model = self.model
        return DefaultSerializer

    def get_queryset(self):
        """
        Get the list of items for this view.
        This must be an iterable, and may be a queryset.
        Defaults to using `self.queryset`.

        You may want to override this if you need to provide different
        querysets depending on the incoming request.

        (Eg. return a list of items that is specific to the user)
        """
        if self.queryset is not None:
            return self.queryset._clone()

        if self.model is not None:
            return self.model._default_manager.all()

        raise ImproperlyConfigured("'%s' must define 'queryset' or 'model'"
                                    % self.__class__.__name__)

    def get_filtered_queryset(self):
        queryset = self.filter_queryset(self.get_queryset())
        me = getattr(self, '_me_creating__object_name', None)
        if me is not None:
            if me == "self":
                user = self.request.user.pk
            else:
                user = self.request.user.pk
            queryset = queryset.filter(**{getattr(self, '_me_creating__object_name'): user})
        return queryset

    def get_object(self, queryset=None):
        """
        Returns the object the path is representing.

        You may want to override this if you need to provide non-standard
        queryset lookups.  Eg if objects are referenced using multiple
        keyword arguments in the url conf.
        """
        # Determine the base queryset to use.
        if queryset is None:
            queryset = self.filter_queryset(self.get_queryset())
        else:
            pass  # Deprecation warning

        if self.endpoint and self.use_endpoint_filter:
            filter_kwargs = self.endpoint.get_object_filter(self.request, *self.args, **self.kwargs)
        else:
            filter_kwargs = self.kwargs

        if not filter_kwargs:
            raise ImproperlyConfigured(
                'Expected view %s to be called with a list of field lookups'
                '"%s" could not be translated accordingly. You migh want to set the "parent_field" attribute of this endpoint.' %
                (self.__class__.__name__, str(self.kwargs))
            )


        obj = get_object_or_404(queryset, **filter_kwargs)

        # May raise a permission denied
        self.check_object_permissions(self.request, obj)

        return obj

    def get_related_object(self, obj_name, init_kwargs=None):
        if obj_name in self.endpoint.depends_on:
            endpoint = self.endpoint.depends_on[obj_name]

            init_kwargs = init_kwargs or {}
            init_kwargs['endpoint'] = endpoint
            init_kwargs['dispatch'] = False

            view = endpoint.view_class.as_view(**init_kwargs)

            return view(self.request, *self.args, **self.kwargs).get_object()

        raise Exception, 'dependency not declared' # TODO


    ########################
    ### The following are placeholder methods,
    ### and are intended to be overridden.
    ###
    ### The are not called by GenericAPIView directly,
    ### but are used by the mixin methods.

    def pre_save(self, obj):
        """
        Placeholder method for calling before saving an object.

        May be used to set attributes on the object that are implicit
        in either the request, or the url.
        """
        pass

    def post_save(self, obj, created=False):
        """
        Placeholder method for calling after saving an object.
        """
        pass

    def metadata(self, request):
        """
        Return a dictionary of metadata about the view.
        Used to return responses for OPTIONS requests.

        We override the default behavior, and add some extra information
        about the required request body for POST and PUT operations.
        """
        ret = {}

        actions = {}
        for method in ('PUT', 'POST'):
            if method not in self.allowed_methods:
                continue

            cloned_request = clone_request(request, method)
            try:
                # Test global permissions
                self.check_permissions(cloned_request)
                # Test object permissions
                if method == 'PUT':
                    self.get_object()
            except (exceptions.APIException, PermissionDenied, Http404, MultipleObjectsReturned):
                pass
            else:
                # If user has appropriate permissions for the view, include
                # appropriate metadata about the fields that should be supplied.
                serializer = self.get_serializer()
                actions[method] = serializer.metadata()

        if 'DELETE' in self.allowed_methods:
            cloned_request = clone_request(request, 'DELETE')
            try:
                # Test global permissions
                self.check_permissions(cloned_request)
                self.get_object()
            except (exceptions.APIException, PermissionDenied, Http404, MultipleObjectsReturned):
                pass
            else:
                actions['DELETE'] = None

        if actions:
            if not 'actions' in ret:
                ret['actions'] = {}
            ret['actions'].update(actions)

        return super(GenericAPIView, self).metadata(request, defaults=ret)


##########################################################
### Concrete view classes that provide method handlers ###
### by composing the mixin classes with the base view. ###
##########################################################

class CreateAPIView(mixins.CreateModelMixin,
                    GenericAPIView):

    """
    Concrete view for creating a model instance.
    """
    def post(self, request, *args, **kwargs):
        return self.create(request, *args, **kwargs)


class ListAPIView(mixins.ListModelMixin,
                  GenericAPIView):
    """
    Concrete view for listing a queryset.
    """
    def get(self, request, *args, **kwargs):
        return self.list(request, *args, **kwargs)


class RetrieveAPIView(mixins.RetrieveModelMixin,
                      GenericAPIView):
    """
    Concrete view for retrieving a model instance.
    """
    def get(self, request, *args, **kwargs):
        return self.retrieve(request, *args, **kwargs)


class DestroyAPIView(mixins.DestroyModelMixin,
                     GenericAPIView):

    """
    Concrete view for deleting a model instance.
    """
    def delete(self, request, *args, **kwargs):
        return self.destroy(request, *args, **kwargs)


class UpdateAPIView(mixins.UpdateModelMixin,
                    GenericAPIView):

    """
    Concrete view for updating a model instance.
    """
    def put(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def patch(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)


class ListCreateAPIView(mixins.ListModelMixin,
                        mixins.CreateModelMixin,
                        GenericAPIView):
    """
    Concrete view for listing a queryset or creating a model instance.
    """
    def get(self, request, *args, **kwargs):
        return self.list(request, *args, **kwargs)

    def post(self, request, *args, **kwargs):
        return self.create(request, *args, **kwargs)


class RetrieveUpdateAPIView(mixins.RetrieveModelMixin,
                            mixins.UpdateModelMixin,
                            GenericAPIView):
    """
    Concrete view for retrieving, updating a model instance.
    """
    def get(self, request, *args, **kwargs):
        return self.retrieve(request, *args, **kwargs)

    def put(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def patch(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)


class RetrieveDestroyAPIView(mixins.RetrieveModelMixin,
                             mixins.DestroyModelMixin,
                             GenericAPIView):
    """
    Concrete view for retrieving or deleting a model instance.
    """
    def get(self, request, *args, **kwargs):
        return self.retrieve(request, *args, **kwargs)

    def delete(self, request, *args, **kwargs):
        return self.destroy(request, *args, **kwargs)


class RetrieveUpdateDestroyAPIView(mixins.RetrieveModelMixin,
                                   mixins.UpdateModelMixin,
                                   mixins.DestroyModelMixin,
                                   GenericAPIView):
    """
    Concrete view for retrieving, updating or deleting a model instance.
    """
    def get(self, request, *args, **kwargs):
        return self.retrieve(request, *args, **kwargs)

    def put(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def patch(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def delete(self, request, *args, **kwargs):
        return self.destroy(request, *args, **kwargs)

##########################
### Deprecated classes ###
##########################

class MultipleObjectAPIView(GenericAPIView):
    def __init__(self, *args, **kwargs):
        warnings.warn(
            'Subclassing `MultipleObjectAPIView` is due to be deprecated. '
            'You should simply subclass `GenericAPIView` instead.',
            PendingDeprecationWarning, stacklevel=2
        )
        super(MultipleObjectAPIView, self).__init__(*args, **kwargs)


class SingleObjectAPIView(GenericAPIView):
    def __init__(self, *args, **kwargs):
        warnings.warn(
            'Subclassing `SingleObjectAPIView` is due to be deprecated. '
            'You should simply subclass `GenericAPIView` instead.',
            PendingDeprecationWarning, stacklevel=2
        )
        super(SingleObjectAPIView, self).__init__(*args, **kwargs)
