from ..exceptions import IntrospectiveApiException


class IntrospectiveApiClientException(IntrospectiveApiException):
    _traceback = None
    
    def __init__(self, introspective_api_object=None, attr=None, *args, **kwargs):
        self._introspective_api_object = introspective_api_object
        self._attr = attr
        self._msg = kwargs.pop('msg', None)
        if isinstance(self._attr, BaseException):
            import traceback
            self._traceback = traceback.format_exc()
        super(IntrospectiveApiClientException, self).__init__(*args, **kwargs)
        
    def as_html(self, ):
        return self.get_request() + "<br />" + self.get_response() + "<br />" + self.get_additional()
    
    def get_request(self, ):
        return "" # TODO
    
    def get_response(self, ):
        if hasattr(self._introspective_api_object, '_body'):
            return self._introspective_api_object._body
        else:
            return ""
    
    def get_msg(self, ):
        return self._msg
    
    
    def get_additional(self, ):
        ret = {'traceback': self._traceback,}
        if hasattr(self._introspective_api_object, '_status') and self._introspective_api_object._status:
            ret['response_status'] = self._introspective_api_object._status
        if hasattr(self._introspective_api_object, '_header') and self._introspective_api_object._header:
            ret['response_header'] = self._introspective_api_object._header
        if hasattr(self._introspective_api_object, '_url') and self._introspective_api_object._url:
            ret['resquest_url'] = self._introspective_api_object._url
        return ret
    
    