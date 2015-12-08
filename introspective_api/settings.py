"""
Settings for REST framework are all namespaced in the REST_FRAMEWORK setting.
For example your project's `settings.py` file might look like this:

REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': (
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.YAMLRenderer',
    )
    'DEFAULT_PARSER_CLASSES': (
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.YAMLParser',
    )
}

This module provides the `api_setting` object, that is used to access
REST framework settings, checking for user settings first, then falling
back to the defaults.
"""
import logging
from django.conf import settings#, UserSettingsHolder
from django.utils.functional import LazyObject, empty
from django.utils import importlib
from rest_framework.settings import api_settings as rest_settings


USER_SETTINGS = getattr(settings, 'INTROSPECTIVE_API', None)

DEFAULTS = {
    'RELATED_VIEWS_IN_HEADER': True,
    
    'STATIC_ENDPOINT_CONFIG': 'introspective_api.endpoints.get_statics_config',
    'JS_ENDPOINT_TEMPLATE': 'introspective_api/endpoint_template.js',
    'STATIC_ENDPOINT_FOLDER': (settings.STATIC_ROOT or './')+'js/endpoint/',
        
    'LOG_CLIENT': False,

    'VALID_URL_PATTERNS_EXPR': '[a-zA-Z0-9\/\-$_.+!*\'(),]*',
    
    'QUERY_PARAM_PREFIX': '!',
    
    'PAGINATE_BY_PARAM': 'paginate_by',
    
    'PAGINATION_IN_HEADER': True,
    'PAGINATION_RANGE_HEADER_TOKEN': [
        'x-records',
        'x-pages',
        'x-days'
    ],
    'VIEW_TYPE_HEADER': False,
    'VIEW_TYPE_HEADER_NAME': 'View-Type',
    'VIEW_TYPE_HEADERS': {
        'LIST': 'List',
        'DETAIL': 'Detail'
    },

    'JSON_ENCODER': 'introspective_api.encoders.AdvancedEncorder',

    'ACTION_QUERY_PARAM': 'action',
    
    'DEFAULT_MODEL_SERIALIZER_CLASS':
        'introspective_api.serializers.ModelSerializer',
    'DEFAULT_PAGINATION_SERIALIZER_CLASS':
        'introspective_api.pagination.PaginationSerializer',
        
#    'AUTH_CONSUMER_MODEL':
#        'introspective_api.consumers.models.Consumer',
#    'AUTH_ACCESS_KEY_MODEL':
#        'introspective_api.consumers.models.AccessKey',
        
    'API_CREDENTIALS_VIEW':
        'introspective_api.consumers.views.get_credentials',
        
    'API_RESPONSE_CLASS':
        'introspective_api.response.ApiResponse',
    'API_RESPONSE_CODE_ATTR_NAME':
        'code',
    'API_RESPONSE_CODE_PREFIX':
        None,
    'AUTO_UUID_FIELD':
        'introspective_api.fields.AutoUUIDField',
    'API_NAMESPACE':
        'api',
    'API_URL':
        'api/',
    'API_ROOT_NAME':
        'api-root',
}


# List of settings that may be in string import notation.
IMPORT_STRINGS = ('DEFAULT_MODEL_SERIALIZER_CLASS',
                  'DEFAULT_PAGINATION_SERIALIZER_CLASS',
                  #'AUTH_CONSUMER_MODEL',
                  #'AUTH_ACCESS_KEY_MODEL',
                  'API_RESPONSE_CLASS',
                  'AUTO_UUID_FIELD',
                  'API_CREDENTIALS_VIEW',
                  'STATIC_ENDPOINT_CONFIG',
                  'JSON_ENCODER'
)


def perform_import(val, setting_name):
    """
    If the given setting is a string import notation,
    then perform the necessary import or imports.
    """
    if isinstance(val, basestring):
        return import_from_string(val, setting_name)
    elif isinstance(val, (list, tuple)):
        return [import_from_string(item, setting_name) for item in val]
    return val


def import_from_string(val, setting_name):
    """
    Attempt to import a class from a string representation.
    """
    parts = val.split('.')
    module_path, class_name = '.'.join(parts[:-1]), parts[-1]
    try:
        # Nod to tastypie's use of importlib.
        module = importlib.import_module(module_path)
        return getattr(module, class_name)
    except AttributeError:
        msg = "Could not import Class '%s' from module '%s' for API setting '%s'" % (class_name, module_path, setting_name)
        raise ImportError(msg)
    except:
        msg = "Could not import '%s' for API setting '%s'" % (val, setting_name)
        raise# ImportError(msg)

class APISettings(object):
    """
    A settings object, that allows API settings to be accessed as properties.
    For example:

        from introspective_api.settings import introspection_settings
        print introspection_settings.DEFAULT_RENDERER_CLASSES

    Any setting with string import paths will be automatically resolved
    and return the class, rather than the string literal.
    """
    def __init__(self, user_settings=None, defaults=None, import_strings=None, parent_settings=None):
        self.user_settings = user_settings or {}
        self.defaults = defaults or {}
        self.import_strings = import_strings or ()
        self.parent_settings = parent_settings or {}

    def __getattr__(self, attr):
        if attr not in self.defaults.keys():
            if self.parent_settings:
                return getattr(self.parent_settings, attr)
            raise AttributeError("Invalid API setting: '%s'" % attr)

        try:
            # Check if present in user settings
            val = self.user_settings[attr]
        except KeyError:
            # Fall back to defaults
            val = self.defaults[attr]

        # Coerce import strings into classes
        if val and attr in self.import_strings:
            val = perform_import(val, attr)

        self.validate_setting(attr, val)

        # Cache the result
        setattr(self, attr, val)
        return val

    def validate_setting(self, attr, val):
        if attr == 'FILTER_BACKEND' and val is not None:
            # Make sure we can initilize the class
            val()

class UserSettingsHolder(APISettings):
    """
    Holder for user configured settings.
    """
    # SETTINGS_MODULE doesn't make much sense in the manually configured
    # (standalone) case.
    SETTINGS_MODULE = None

    def __init__(self, default_settings):
        """
        Requests for configuration variables not in this class are satisfied
        from the module specified in default_settings (if possible).
        """
        self.__dict__['_deleted'] = set()
        self.default_settings = default_settings

    def __getattr__(self, name):
        if name in self._deleted:
            raise AttributeError
        return getattr(self.default_settings, name)

    def __setattr__(self, name, value):
        self._deleted.discard(name)
        return super(UserSettingsHolder, self).__setattr__(name, value)

    def __delattr__(self, name):
        self._deleted.add(name)
        return super(UserSettingsHolder, self).__delattr__(name)

    def __dir__(self):
        return list(self.__dict__) + dir(self.default_settings)

real_introspection_settings = APISettings(USER_SETTINGS, DEFAULTS, IMPORT_STRINGS)
real_api_settings = APISettings(USER_SETTINGS, DEFAULTS, IMPORT_STRINGS, rest_settings)


class LazySettings(LazyObject):
    """
    A lazy proxy for either global Django settings or a custom settings object.
    The user can manually configure settings prior to using them. Otherwise,
    Django uses the settings module pointed to by DJANGO_SETTINGS_MODULE.
    """
    def __init__(self, *args, **kwargs):
        super(LazySettings, self).__init__(*args, **kwargs)
        self._wrapped = real_api_settings
        
    def _setup(self, name=None):
        """
        Load the settings module pointed to by the environment variable. This
        is used the first time we need any settings at all, if the user has not
        previously configured the settings manually.
        """
        
        self._wrapped = real_api_settings
        self._configure_logging()

    def __getattr__(self, name):
        if self._wrapped is empty:
            self._setup(name)
        return getattr(self._wrapped, name)

    def _configure_logging(self):
        """
        Setup logging from LOGGING_CONFIG and LOGGING settings.
        """
        try:
            # Route warnings through python logging
            logging.captureWarnings(True)
            # Allow DeprecationWarnings through the warnings filters
            warnings.simplefilter("default", DeprecationWarning)
        except AttributeError:
            # No captureWarnings on Python 2.6, DeprecationWarnings are on anyway
            pass

        if self.LOGGING_CONFIG:
            from django.utils.log import DEFAULT_LOGGING
            # First find the logging configuration function ...
            logging_config_path, logging_config_func_name = self.LOGGING_CONFIG.rsplit('.', 1)
            logging_config_module = importlib.import_module(logging_config_path)
            logging_config_func = getattr(logging_config_module, logging_config_func_name)

            logging_config_func(DEFAULT_LOGGING)

            if self.LOGGING:
                # Backwards-compatibility shim for #16288 fix
                compat_patch_logging_config(self.LOGGING)

                # ... then invoke it with the logging settings
                logging_config_func(self.LOGGING)

    def configure(self, default_settings=real_api_settings, **options):
        """
        Called to manually configure the settings. The 'default_settings'
        parameter sets where to retrieve any unspecified values from (its
        argument must support attribute access (__getattr__)).
        """
        if self._wrapped is not empty:
            raise RuntimeError('Settings already configured.')
        holder = UserSettingsHolder(default_settings)
        for name, value in options.items():
            setattr(holder, name, value)
        self._wrapped = holder
        self._configure_logging()

    @property
    def configured(self):
        """
        Returns True if the settings have already been configured.
        """
        return self._wrapped is not empty

api_settings = LazySettings()
