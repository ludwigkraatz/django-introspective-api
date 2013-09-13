from rest_framework.response import Response
from introspective_api.settings import api_settings
from introspective_api.views import APIView

class DictWithApiCode(dict):
    def __init__(self, data, code=None, code_prefix=api_settings.API_RESPONSE_CODE_PREFIX):
        if code:
            data[api_settings.API_RESPONSE_CODE_ATTR_NAME] = (code_prefix or '') + code
        super(DictWithApiCode, self).__init__(data)
    
class ApiResponse(Response):
    """
    An HttpResponse that allows it's data to be rendered into
    arbitrary media types.
    """

    def __init__(self, *args, **kwargs):
        """
        Alters the init arguments slightly.
        For example, drop 'template_name', and instead use 'data'.

        Setting 'renderer' and 'media_type' will typically be deferred,
        For example being set automatically by the `APIView`.
        """
        
        self._code = kwargs.pop('code', None)
        
        super(ApiResponse, self).__init__(*args, **kwargs)
        
        if self._code:
            self.data = DictWithApiCode(self.data, self._code)

    def finalize_for(self, request):
        return APIView().finalize_response(request, self) # TODO: ugly
    