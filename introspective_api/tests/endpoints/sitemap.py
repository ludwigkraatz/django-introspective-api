from viral_marketing.api import api_root
from introspective_api.response import ApiResponse

from django import shortcuts
from django import template
from django.views.decorators.cache import cache_control

from introspective_api.views import APIView

ENDPOINT_NAME = 'leads'

api_root.activate(
    name='leads',
    )
#api_root.activate(
#    name='customers',
#    )

class LeadView(APIView):
    def get_object(self, *args, **kwargs):
        class x(dict):
            x = 1
        
        return x
    
    def get(self, request, *args, **kwargs):
        return ApiResponse(self.get_object()).finalize_for(request)
    

customers = api_root.register_endpoint('customers',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='customers-root'
        )
customer = customers.register_filter('customer', '[0-9]*',
            view=lambda request, customer: ApiResponse({}).finalize_for(request),
            view_name='customer-details'
        )

leads = api_root.register_endpoint('leads',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='leads-root'
        )
lead = leads.register_filter('lead', '[0-9]*',
            view=LeadView,
            view_name='lead-details'
        )
customer = lead.register_redirect('customer', customer, {'customer': 'x'},
            view=lambda request: ApiResponse({}).finalize_for(request),
            permanent_redirect = True
        )
fb = lead.register_endpoint('fb',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='lead-fb-view'
        )
posts = fb.register_endpoint('posts',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='lead-fb-posts'
        )
post = posts.register_filter('post', '[0-9]*',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='lead-fb-post-detail'
        )
post = posts.register_filter('post', '[a-z]*',
            view=lambda request: ApiResponse({}).finalize_for(request),
            view_name='lead-fb-post-detail2'
        )