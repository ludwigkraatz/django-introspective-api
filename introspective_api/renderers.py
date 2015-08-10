from rest_framework.renderers import *
from rest_framework.utils import encoders
from django.conf import settings
#import six
import json
from django.db.models.fields.files import FieldFile
import uuid

# TODO: https://tools.ietf.org/html/rfc6573 - implement <a href="" rel="item|collection"></a>


class AdvancedEncoder(encoders.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, FieldFile):
            return str(obj.url) if obj.name else None
        # Let the base class default method raise the TypeError
        return encoders.JSONEncoder.default(self, obj)

JSONRenderer.encoder_class = AdvancedEncoder


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
