from django.conf.urls import patterns, include, url
from .endpoints import api_root


from django.conf import settings
from django.utils import importlib


for app in settings.INSTALLED_APPS:
    if app.endswith('.api') or app == 'api':
        importlib.import_module("{app}".format(app=app))
    else:
        try:
            # import the api models now
            # this initializes the api root endpoint
            importlib.import_module("{app}.api".format(app=app))
        except ImportError, e:
            if str(e) != 'No module named api' and str(e) != 'No module named {app}.api'.format(app=app):
                raise

urlpatterns = api_root.url_patterns
