from rest_framework.renderers import *
from django.conf import settings
#import six
import json
from introspective_api.settings import api_settings

# TODO: https://tools.ietf.org/html/rfc6573 - implement <a href="" rel="item|collection"></a>

JSONRenderer.encoder_class = api_settings.JSON_ENCODER

class PlainTextRenderer(BaseRenderer):
    """
    Plain text parser.
    """
    media_type = 'text/plain'
    format = 'txt'
    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, dict):
            if 'msg' in data:
                return data['msg']

        if hasattr(data, 'msg'):
            if callable(data.msg):
                return data.msg()
            return data.msg

        if isinstance(data, (list, tuple)) and all(isinstance(entry, basestring) for entry in data):
            return '\n'.join(data)


        return str(data)

class HTMLRenderer(BaseRenderer):
    """
    Plain text parser.
    """
    media_type = 'text/html'
    format = 'html'
    def render(self, data, accepted_media_type=None, renderer_context=None):
        if isinstance(data, dict):
            if 'html' in data:
                return data['html']

        if hasattr(data, 'html'):
            if callable(data.html):
                return data.html()
            return data.html

        return str(data)
