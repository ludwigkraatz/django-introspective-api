#from introspective_api import authentication as auth
from introspective_api.settings import api_settings
from django.contrib.auth.models import AnonymousUser
from django.utils.functional import SimpleLazyObject
from django.contrib.auth import get_user_model
from introspective_api.client import IntrospectiveApiClientException
from introspective_api.exceptions import ApiKeyNeedsRevalidation, InvalidKey, InteractionException
import json
from introspective_api import get_access_key_model, get_consumer_model
from django.core.urlresolvers import reverse
from django.utils import timezone
ApiResponse = api_settings.API_RESPONSE_CLASS

import hawk


def get_RevalidationException_Response(request, exception):
    return ApiResponse(
                {"msg": "Not Authenticated", "detail": "key expired"},
                code="django-introspectiveapi-key-needs-revalidation",
                status=401
            ).finalize_for(request)
def get_InvalidKeyException_Response(request, exception):
    return ApiResponse(
            {"msg": "Not Authenticated", "detail": "key expired"},
            code="django-introspectiveapi-auth-invalid",
            status=401
        ).finalize_for(request)
def get_HawkExceptions_Response(request, exception):
    return ApiResponse(
            {"msg": "Not Authenticated", "detail": "error"},
            code="django-introspectiveapi-auth-invalid",
            status=401
        ).finalize_for(request)
def get_HawkMissing_Response(request, code='AUTHENTICATION MISSING'):
        ret = ApiResponse(
            {"msg": "HAWK auth needed for API"},
            code=code,
            status=401
        ).finalize_for(request)
        ret['Location'] = request.build_absolute_uri(reverse('api:profile-auth')) + '?action=authenticate'  # TODO: own login view
        return ret


def get_ClientException_Response(request, exception):    
    return ApiResponse(
        {"msg": "Internal Server Communication Error", "detail": str(exception.as_html())},
        code="error",
        status=500).finalize_for(request)


class API_Client_Middleware(object): 
    def process_exception(self, request, exception):
        if isinstance(exception, IntrospectiveApiClientException):
            return get_ClientException_Response(request, exception)
        return None    

class API_User_Middleware(object):
    def process_request(self, request):
        if hasattr(request, 'api_user'):
            if hasattr(request, 'user'):
                if request.user.is_authenticated():
                    if request.user != request.api_user.get_user():
                        raise Exception, "Authentified User is diefferent from API User"
                else:
                    request.user = SimpleLazyObject(lambda: request.api_user.get_user())
            else:
                request.user = SimpleLazyObject(lambda: request.api_user.get_user())
        else:
            if not hasattr(request, 'user'):
                request.user = AnonymousUser()
        return None

class API_Version_Middleware(object):
    def process_request(self, request):
        version     = request.GET.get('version', None)

class HAWK_Authentication(object):
    def get_credentials_lookup(self):
        def credentials_lookup(id):
            
            #if id == "test":
            #    return get_access_key_model()(id="test", secret="test").as_internal_credentials()
            
            try:
                key = get_access_key_model().objects.get(id=id)
            except get_access_key_model().DoesNotExist:                
                raise InvalidKey
                
            if key.is_valid():
                return key.as_internal_credentials()
            else:
                raise ApiKeyNeedsRevalidation
        
        return credentials_lookup
    
    def get_request_dict(self, request):
        return {
                        'headers': {
                            'authorization': request.META["HTTP_AUTHORIZATION"]
                        },
                        'method': request.method,
                        'host':request.META["HTTP_HOST"].split(":")[0],
                        'port':request.META["SERVER_PORT"],
                        'url':request.get_full_path(),
                        'contentType': request.META["CONTENT_TYPE"]
                    }
    
    
    def process_request(self, request):
        if "HTTP_AUTHORIZATION" in request.META:
            if request.META["HTTP_AUTHORIZATION"].startswith('Hawk '):
                try:
                    req = self.get_request_dict(request)
                    
                    artifacts = hawk.Server(req = req, credentials_fn = self.get_credentials_lookup()).authenticate(req, {
                    #'payload': req.DATA #TODO
                    })
                    
                    if False: #if timestamp out of time
                        pass
                        # TODO
                        # return Response with current timestemp for sync
                    
                    api_user_id = artifacts['id']
                    
                    api_user    =   get_access_key_model().objects.get(
                            id = api_user_id
                            )
                    api_user.set_artifacts(artifacts)
                    
                    request.api_user = api_user
                except hawk.util.HawkException, e:
                    return get_HawkExceptions_Response(request, e)
                    raise#return None # TODO raise Exception?
                except ApiKeyNeedsRevalidation, e:
                    return get_RevalidationException_Response(request, e)
                except InvalidKey, e:
                    return get_InvalidKeyException_Response(request, e)
            
            # TODO: if DEBUG
            #elif request.META["HTTP_AUTHORIZATION"].startswith('TEST '):
            #    from django.conf import settings
            #    if not settings.DEBUG:
            #        return get_HawkMissing_Response(request, "auth-saml")#todo
            #    
            #    api_user_id = "test"
            #    
            #    api_user    =   get_access_key_model().objects.get(
            #            id = api_user_id
            #            )
            #    request.api_user = api_user
        else:
            if not (hasattr(request, 'user') and request.user.is_authenticated()):
                from django.conf import settings
                if settings.DEBUG and request.GET.get('test', None) == 'true':
                    from django.contrib.auth import login, authenticate, get_user_model
                    # TODO: this is not done
                    user = get_user_model().objects.latest('pk')
                    login(request, user)

                if request.path.startswith("/api/me/") or request.GET.get('private', False):
                    if False:
                        return None # TODO: fix
                    else:
                        return get_HawkMissing_Response(request)
        return None
    
    def process_response(self, request, response):
        if response.status_code == 500:
            return response
        if hasattr(request, "api_user"):
            req = self.get_request_dict(request)
            header = hawk.Server(req = req, credentials_fn = self.get_credentials_lookup()).header(
                artifacts   =   request.api_user.get_artifacts(),
                options     =   {
                    'payload': response.content if request.method != 'HEAD' else None,
                    'contentType': response['Content-Type']
                }
                )
            
            if header:
                response['Server-Authorization'] = header
            
        return response
    
    def process_exception(self, request, exception):
        if isinstance(exception, ApiKeyNeedsRevalidation):
            return get_RevalidationException_Response(request, exception)
        if isinstance(exception, InvalidKey):
            return get_InvalidKeyException_Response(request, exception)
        return None


