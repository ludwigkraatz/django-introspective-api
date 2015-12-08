from rest_framework.utils import encoders
import uuid
from django.db.models.fields.files import FieldFile


class AdvancedEncoder(encoders.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, uuid.UUID):
            return str(obj)
        if isinstance(obj, FieldFile):
            return str(obj.url) if obj.name else None
        # Let the base class default method raise the TypeError
        return encoders.JSONEncoder.default(self, obj)
