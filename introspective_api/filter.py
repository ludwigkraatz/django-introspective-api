


class EndpointFilterBackend(object):
    def filter_queryset(self, request, queryset, view):
        endpoint_filter = view.endpoint.get_object_filter(request, *view.args, **view.kwargs)
        if endpoint_filter:
            return queryset.filter(**endpoint_filter)
        return queryset