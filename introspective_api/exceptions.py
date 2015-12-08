from rest_framework.exceptions import *

class ApiKeyNeedsRevalidation(Exception):
class IntrospectiveApiException(Exception):
    pass


class ApiKeyNeedsRevalidation(IntrospectiveApiException):
    #code
    pass

class HawkAuthorizationRequired(IntrospectiveApiException):
    #code
    pass

class InvalidKey(HawkAuthorizationRequired):
    pass


class EndpointNotFound(IntrospectiveApiException):
    pass
