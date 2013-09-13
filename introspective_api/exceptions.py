from rest_framework.exceptions import *

class ApiKeyNeedsRevalidation(Exception):
    #code
    pass

class HawkAuthorizationRequired(Exception):
    #code
    pass

class InvalidKey(HawkAuthorizationRequired):
    pass
