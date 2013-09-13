      


import hawk
import hawk.util

# TODO make ntpd run on this server
class HawkAuthentication(object):
    def authenticate(self, request):
        try:            
            return request._request.user, request._request.api_user
        except AttributeError:
            return request._request.user,  None # TODO raise Exception?
"""        

SESSION_KEY_API_USER = '_api_user_id'
SESSION_KEY_USER = '_auth_user_id'
BACKEND_SESSION_KEY = '_auth_user_backend'
REDIRECT_FIELD_NAME = 'next'

def get_api_user(request):
    try:
        user_id = request.session[SESSION_KEY_API_USER]
        backend_path = request.session[BACKEND_SESSION_KEY]
        backend = load_backend(backend_path)
        user = backend.get_api_user(user_id) or None
    except KeyError:
        user = None
    return user

def get_user(request):
    from django.contrib.auth.models import AnonymousUser
    try:
        user_id = request.session[SESSION_KEY]
        backend_path = request.session[BACKEND_SESSION_KEY]
        backend = load_backend(backend_path)
        user = backend.get_api_user(user_id) or AnonymousUser()
    except KeyError:
        user = AnonymousUser()
    return user

def authenticate(**credentials):
    for backend in get_backends():
        try:
            user = backend.authenticate(**credentials)
        except TypeError:
            # This backend doesn't accept these credentials as arguments. Try the next one.
            continue
        if user is None:
            continue
        # Annotate the user object with the path of the backend.
        user.backend = "%s.%s" % (backend.__module__, backend.__class__.__name__)
        return user

    # The credentials supplied are invalid to all backends, fire signal
    user_login_failed.send(sender=__name__,
            credentials=_clean_credentials(credentials))


def login(request, user):
    if user is None:
        user = request.user
    # TODO: It would be nice to support different login methods, like signed cookies.
    if SESSION_KEY in request.session:
        if request.session[SESSION_KEY] != user.id:
            # To avoid reusing another user's session, create a new, empty
            # session if the existing session corresponds to a different
            # authenticated user.
            request.session.flush()
    else:
        request.session.cycle_key()
    request.session[SESSION_KEY] = user.id
    request.session[BACKEND_SESSION_KEY] = user.backend
    if hasattr(request, 'user'):
        request.user = user
    user_logged_in.send(sender=user.__class__, request=request, user=user)
    """