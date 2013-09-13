from rest_framework.views import APIView
from introspective_api.response import ApiResponse
from introspecitve_api import endpoints

class DiscoverDict(object):
    def __init__(self):
        self.lookups = {}
    def __getitem__(self,name,default=None):
        if not name in self.lookups:
            self.lookups[name] = None
            if not default:
                raise KeyError
            return default

class Autodiscovery(APIView):
    
    # a django regex url is being transformed to an absolute URL with {missing_attribute} notation
    # the missing_attribute is in this case an attribute of a object.
    # Ususally missing_attribute is id
    def templatize_url(self, view_name):
        return url
    
    def get(self, request, **kwargs):
        headers = {}
        link_templates = []
        
        for endpoint in endpoints.list_endpoints():
            link_templates.append(
                '<{url}>; rel="{rel_name}"'.format(url=self.templatize_url(), rel=endpoint)
            )
        
        headers["Link-Template"] = ", ".join(link_templates)
        
        return ApiResponse(headers=headers)
    
    