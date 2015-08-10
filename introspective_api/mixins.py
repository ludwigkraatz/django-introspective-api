"""
Basic building blocks for generic class based views.

We don't bind behaviour to http method handlers yet,
which allows mixin classes to be composed in interesting ways.
"""
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.templatetags.rest_framework import replace_query_param
from rest_framework.mixins import *
import itertools
from introspective_api.views import APIView


class ListModelMixin(ListModelMixin):
    """
    List a queryset.
    Should be mixed in with `MultipleObjectAPIView`.
    """
    empty_error = u"Empty list and '%(class_name)s.allow_empty' is False."
    object_list = None

    def parse_range_header(self, result_range):
        starts = []
        ends = []
        for result_range in result_range.split(","):
            start = end = None
            if result_range.startswith("-"):
                start = int(result_range)# + 1
            elif result_range.endswith("-"):
                start = int(result_range.split("-")[0])
            else:
                start, end = result_range.split("-")
                start, end = int(start), int(end) + 1
                
            starts.append(start)
            ends.append(end)
            
        return starts, ends
    
    sort_by_identifier_mapping = {
        'first_name': ['firstname'],
        'last_name': ['lastname'],
    }
    
    def translate_sort_by_identifier(self, sort_by_identifier):
        for key, value in self.sort_by_identifier_mapping.iteritems():
            if sort_by_identifier in value:
                return key
        return sort_by_identifier
        
    
    
    def apply_sorting(self, object_list):
            
        page_sort_by = self.request.GET.get('sort-by', None)
        page_sort_method = self.request.GET.get('sort-method', None)
        page_sort_startswith = self.request.GET.get('startswith', None)
        
        if page_sort_method in ['asc', 'desc'] and page_sort_by:
            object_list = object_list.order_by(
                ('-' if page_sort_method == "desc"  else '') +\
                self.translate_sort_by_identifier(page_sort_by)
                )
            if page_sort_startswith:
                # TODO: test if its a CHAR field or smth l that
                object_list = object_list.filter(**{self.translate_sort_by_identifier(page_sort_by)+'__startswith': page_sort_startswith})
            
            return object_list
        
        return object_list
    
    def list(self, request, *args, **kwargs):
        obj_list = getattr(self, 'object_list', None)
        if obj_list is None:
            obj_list = self.get_filtered_queryset()
            
        self.object_list = self.apply_sorting( obj_list )
        status_code = None
        headers = {}
        partial_content = False
        
        try:
            # use querysets .count() to get quantity of elements
            records_count = self.object_list.count()
            
        except TypeError, AttributeError:
            # TypeError: []
            # AttributeError: obj.__len__ might be available
            records_count = len(self.object_list)

        # Default is to allow empty querysets.  This can be altered by setting
        # `.allow_empty = False`, to raise 404 errors on empty querysets.
        allow_empty = self.allow_empty
        if not allow_empty and records_count == 0:
            error_args = {'class_name': self.__class__.__name__}
            raise Http404(self.empty_error % error_args)

        if 'HTTP_RANGE' in self.request.META:
            token, result_range = self.request.META['HTTP_RANGE'].split("=")
            if token in self.settings.PAGINATION_RANGE_HEADER_TOKEN:
                try:
                    ranges = []
                    records_start, records_end = self.parse_range_header(result_range)
                    
                    for range_start, range_end in zip(records_start, records_end):
                        if range_start is not None and range_start < 0:
                            # Querystes don't support negative indexing (yet?)
                            range_start = records_count + range_start
                            
                        ranges.append((range_start,range_end))
                        
                    if len(ranges) > 1:
                        raise Exception # currently not available
                except:
                    return Response(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, headers=headers)
                
                # ranges can be comma seperated, so multiple lists are possibly requested
                limited_object_list = itertools.chain(*[
                    self.object_list[record_start:record_end]
                    for record_start,record_end
                    in ranges
                ])
                
                serializer = self.get_serializer(limited_object_list, many=True)
                partial_content = True
            else:
                return Response(status=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, headers=headers)
        else:
            
            # Pagination size is set by the `.paginate_by` attribute,
            # which may be `None` to disable pagination.
            page_size = self.get_paginate_by(self.object_list)
            page_nr = int(self.request.GET.get('page',0))
            
            if page_size:
                packed = self.paginate_queryset(self.object_list, page_size)
                paginator, page, queryset, is_paginated = packed
                
                if self.settings.PAGINATION_IN_HEADER:
                    headers['Link'] = headers.get('Link', '')
                    url = self.request and self.request.build_absolute_uri() or ''
                    first_url = replace_query_param(url, 'page', 1)
                    last_url = replace_query_param(url, 'page', paginator.num_pages)
                    if len(headers['Link']):
                        headers['Link'] += ', '
                    headers['Link'] += '<%(url)s>; rel="section"; title="first"' % {'url': first_url}
                    headers['Link'] += ', <%(url)s>; rel="section"; title="last"' % {'url': last_url}
            
            if page_size and page_nr:
                if self.settings.PAGINATION_IN_HEADER:
                    ranges = (((page.number - 1) * page_size, page.number * page_size),)
                    
                    limited_object_list = itertools.chain(*[
                        self.object_list[record_start:record_end]
                        for record_start,record_end
                        in ranges
                    ])
                    serializer = self.get_serializer(limited_object_list, many=True)
                    if page.has_other_pages():
                        url = self.request and self.request.build_absolute_uri() or ''
                        if page.has_next():
                            next_url = replace_query_param(url, 'page', page.next_page_number())
                            headers['Link'] += ', <%(url)s>; rel="section"; title="next"' % {'url': next_url}
                        if page.has_previous():
                            prev_url = replace_query_param(url, 'page', page.previous_page_number())
                            headers['Link'] += ', <%(url)s>; rel="section"; title="previous"' % {'url': prev_url}
                else:                    
                    serializer = self.get_pagination_serializer(page)
            else:
                serializer = self.get_serializer(self.object_list, many=True)
                self.patchRangesHeader(headers)
    
        if partial_content:
            status_code = status.HTTP_206_PARTIAL_CONTENT
            range_token = self.settings.PAGINATION_RANGE_HEADER_TOKEN[0]  # TODO: from request
            
            # currently just 1 range processable
            cur_range = ranges[0]
            
            headers['Content-Range'] = '%(token)s %(records_start)d-%(records_end)d/%(records_count)d' % {
                                'token': range_token,
                                'records_count': records_count,
                                'records_start': cur_range[0] or 0,
                                'records_end': min((cur_range[1] - 1) if cur_range[1] is not None else records_count,records_count-1),
                            }
            self.patchRangesHeader(headers)
            
        headers.update(self.get_response_headers(request, status_code, serializer=serializer))
        return Response(serializer.data, status=status_code, headers=headers)

    def get_response_headers(self, request, *args, **kwargs):
        headers = super(ListModelMixin, self).get_response_headers(request, *args, **kwargs)
        self.patchRangesHeader(headers)
        return headers

    def patchRangesHeader(self, headers):
        headers['Accept-Ranges'] = ','.join(self.settings.PAGINATION_RANGE_HEADER_TOKEN)
    
    def get_paginate_by(self,object_list):
        return int(self.request.GET.get('pagesize',super(ListModelMixin,self).get_paginate_by(object_list)) or 0)
    
    def metadata2(self, request):
        metadata = super(ListModelMixin,self).metadata(request)
        if not 'Accept-Ranges' in metadata:
            metadata['Accept-Ranges'] = []
        for token in self.settings.PAGINATION_RANGE_HEADER_TOKEN:
            if token in metadata['Accept-Ranges']:
                continue
            metadata['Accept-Ranges'].append(token)
        return metadata

