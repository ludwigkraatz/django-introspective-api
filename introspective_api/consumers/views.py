from rest_framework.views import *

from introspective_api.settings import api_settings
from introspective_api import get_access_key_model, get_consumer_model

ApiResponse = api_settings.API_RESPONSE_CLASS


def guess_timezone(request, client_settings=None):
    
    if client_settings and 'utc_offset' in client_settings:
        tz = None # TODO
        #return tz
    
    tz = request.user.get_tz() or guess_timezone_from_request(request)
    
    return tz

def get_credentials__same_system(user, consumer_identifier, client_settings=None):
    length_identifier = 32 #str(uuid) length
    length_secret = 20
    import random, string
    
    AccessKey = get_access_key_model()
    Consumer = get_consumer_model()
    
    consumer = Consumer.objects.get(identifier = consumer_identifier)
    key = AccessKey.objects.create(
            user=             user,
            #auto generated id=                 ''.join(random.choice(string.ascii_lowercase + string.ascii_uppercase + string.digits) for x in range(length_identifier)),
            secret=             ''.join(random.choice(string.ascii_lowercase + string.ascii_uppercase + string.digits) for x in range(length_secret)),
            consumer        = consumer
        )
    
    key.update_client_setings(client_settings)
    
    return key


def get_credentials(request, consumer='public'):
    data = request.POST
    action = data.get("action")
    
    if (not (hasattr(request, 'user') and request.user.is_authenticated())) and data.get('username', None) is not None:
        
        username = data.get('username')
        password = data.get('password')
        
        def wrong_credentials():
            return ApiResponse({
                    "msg": "Wrong Credentials",
                    "authMethod":"credentials",
                },
                code="auth-missing",
                status=401
            ).finalize_for(request) 
        
        
        try:
            mail = EmailAddress.objects.get(email=email)
            if mail.user.check_password(password):
                user = mail.user
                user.backend = 'django.contrib.auth.backends.ModelBackend'
                login(request, mail.user)
            else:
                wrong_credentials()
        except EmailAddress.DoesNotExist:
            return wrong_credentials()
    
    if hasattr(request, 'user') and request.user.is_authenticated():
        
        credentials = request.session.get('ApiCredentials', None) # TODO studid session key..?
        
        client_settings = request.POST.get('settings', {})
        tz = client_settings.get('tz', guess_timezone(request, client_settings))
        if tz:
            client_settings['tz'] = tz
        
        if credentials is None or action == "revalidate":
            credentials = get_credentials__same_system(request.user, consumer, client_settings=client_settings)
            request.session['ApiCredentials'] = credentials
        else:
            updated_settings = credentials.update_client_setings(client_settings)
            #if updated_settings:
            #    update_foreign_system(credentials, updated_settings)
            
        return ApiResponse(credentials.as_credentials()).finalize_for(request)
    else:
        return ApiResponse({
                    "msg": "Please Login",
                    "authMethod":"credentials",
                },
            code="auth-missing",
            status=401
            ).finalize_for(request)
