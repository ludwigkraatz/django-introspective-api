from django.conf.urls import patterns, include, url


from django.conf import settings
from django.utils import importlib


from .endpoints import api_root
from .settings import api_settings

for app in settings.INSTALLED_APPS:
    try:
        # import the api models now
        # this initializes the api root endpoint
        importlib.import_module("{app}.api".format(app=app))
    except ImportError, e:
        if str(e) != 'No module named api' and str(e) != 'No module named {app}.api'.format(app=app):
            raise

urlpatterns = api_root.url_patterns
