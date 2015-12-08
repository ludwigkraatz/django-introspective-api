from rest_framework.exceptions import *
from .response import ApiResponse

def buildInteractionHeader(title=None, target=None, type=None, reason=None, content=None, data=None, scope=None, deadline=None, required=None):
    header = ''

    # the fragment-syntax shouldn't be used (rfc?)? or maybe at some point a "reset form" interaction might communicated this way be targeting it to a reset button <#reset_btn_id>; type='functional' ?
    # or maybe the location this way can be delegated to the body, which might contain a form adressed by <#form_id>; type="form"
    header += '<' + (target or ('#' + (content if isinstance(content, basestring) else ''))) + '>; '
    if title:
        header += 'title="' + title + '"; '
    if type:
        header += 'type="' + type + '"; '
    if reason:
        header += 'reason="' + reason + '"; '
    if content:
        header += 'content='+(('"'+content+'"') if not content is True else 'true')+'; '
        if data is not None:
            raise Exception('only allowed content OR data kwarg, not both')
    elif data:
        if isinstance(data, basestring):
            # TODO: json?!
            raise NotImplementedError('HTTP Header Fields therefore need to be JSON encoded or at least UTF8 capable (which they seem not to be - from first research.)')
        header += 'data="' + data + '"; '
    #if scope:
    #    header += 'scope="' + scope + '"; '
    if deadline:
        header += 'deadline="' + deadline + '"; '
    if required:
        header += 'required="true"; '
    return header[0:-2]


class ResolveError(Exception):
    pass


class ResolveKeyError(ResolveError, KeyError):
    pass


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


class InteractionException(IntrospectiveApiException):
    # overall success guaranteed / not questioned by possible Interaction
    #STATUS_ACCEPTED = '202'

    # interaction required
    # - therefore first redirect
    STATUS_REDIRECT = '303'  # TODO: or rather 302 for HTTP<1.1 agents?
    # - then show 400 and Linked-Interaction header which after successfully executed either returns
    #   a 200 response with requested content / result or redirects 302 FOUND back to original uri
    STATUS_CLIENT_INTERACTION = '400'

    def __init__(self, url=None, **kwargs):
        self.url = url

    def as_url(self, request=None):
        return self.url
    #
    #def get_absolute_url(self, ):
    #    return self.as_url()

    def as_response(self, request):
        raise NotImplementedError()


class InteractionCompleted(InteractionException):
    """
    is thrown, if the purpose of this request is served and not the usual response / processing should be done, but an interaction-related one.
    maybe this only means, the response is a 303 SEE OTHER [resource A] instead of 201 Created [resource B].
        e.g.:
        resource A might be an address and B a country that !had to be created seperatly! before using it as part of the address..)
    """
    def as_response(self, request):
        url = self.as_url(request)
        if not url:
            return ApiResponse({'msg': 'Success'})

        response = ApiResponse({'msg': 'For this request, an interaction is required. Please click the following link and follow the instructions: <a href="'+link+'">'+link+'</a>'})
        # TODO: force html renderer for HTTP1 support: http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.3.3
        #response.accepted_renderer = request.accepted_renderer
        #response.accepted_media_type = request.accepted_media_type
        response.status = self.STATUS_REDIRECT
        response.reason_phrase = 'INTERACTION COMPLETED'

        response['Location'] = url

        return response.finalize_for(request)


class InteractionNeeded(InteractionException):

    def __init__(self, data=None, type='response', status=None, status_text=None, **kwargs):
        # when 202 Accepted can not be sent, because the process is still in need of attention to complete successful
        # it is not clear, whether the action was actually successful or not. Handling the Interaction leads to
        # the resulting Status to be the result for this one. Aborting leads to 400 Bad Request / 409 Conflict
        #
        # 6xx - Process/Transaction executing, but interaction required - or result can be unexpected  # TODO: RFC
        # might send Location Header to point to where the process can be accessed / monitored
        # Understanding for Client:
        #   - 202 until further notice
        #   - 409/4NN when aborted / requirements not executed / Interaction not satisfied  # TODO: RFC
        #       4NN - Interaction Required,
        #           with X-Linked-Interaction which handles
        #               interaction-target,  # where should i interact
        #               interaction-type,  # how should i interact
        #               interaction-reason,  # why should i interact
        #               interaction-data: URI[, scope=popup/_blank/_top/iframe/discover] | json_data
        #               deadline
        #               required
        #           with optional Location Header for Transaction (Monitoring|(Interaction?))
        ## 6x0 - response|header- Response/Header (default: popup)
        ## 6x1 - list          - Array(type, data) [XML | JSON | HTML(<Article>s)] (default: popup)
        ## 6x2 - data          - form|data-structure (default: popup)
        ## 6x3 - iframe-data   - form|data-structure (default: popup)
        ## 6x4 - api-url       - URL (default: popup)
        ## 6x5 - iframe-url    - URL (default: popup)
        ## 6x6 - HTML-url      - URL (default: _top)
        ## 6x7 - interface     - interface-identifier (default: popup)

        # 61x - Data Required
        # 62x - authentication
        # 63x - authorization
        # 64x - Constraint Required
        # 65x - Expansion Required
        # 66x - Removal Requirement
        # 67x - functional Requirement
        # 68x - Server (Setup) Requirement
        self.type = type
        self.data = data
        self.status = status
        self.status_text = status_text
        super(InteractionNeeded, self).__init__(**kwargs)

    def update_header(self, response, request=None, url=None):
        url = url or self.as_url(request)

        if 'Linked-Interaction' in response:
            response['Linked-Interaction'] += ', '
        else:
            response['Linked-Interaction'] = ''

        response['Linked-Interaction'] += buildInteractionHeader(
                target=url or (request.get_full_path() if request else None),
                type=self.type,
                content=True,  # TODO: specify how to find this interaction within body
                required=True
            )

    def as_response(self, request):
        reasonSet = False
        url = self.as_url(request)
        #url = request.build_absolute_uri(url)

        if url and request.path not in url:  # TODO: client_interaction
            self.status = self.STATUS_REDIRECT
            response = ApiResponse({'msg': 'For this request, an interaction is required. Please click the following link and follow the instructions: <a href="'+url+'">'+url+'</a>'})
            # TODO: force html renderer for HTTP1 support: http://www.w3.org/Protocols/rfc2616/rfc2616-sec10.html#sec10.3.3
            #response.accepted_renderer = request.accepted_renderer
            #response.accepted_media_type = request.accepted_media_type
            if not self.status_text:
                self.status_text = 'SEE OTHER'
        else:
            self.status = self.STATUS_CLIENT_INTERACTION
            if self.type == 'action':
                #response = ApiResponse({'actions': {'POST': self.data}})
                self.type = 'form'
                response = ApiResponse(self.data)
            elif self.type != 'response':
                response = ApiResponse(self.data)
            else:
                response = self.data

        response.reason_phrase = self.status_text
        if self.status:
            response.status_code = self.status
            #if self.status == self.STATUS_ACCEPTED:
                #response.reason_phrase = 'ACCEPTED'
                #reasonSet = True

        if not reasonSet and not self.status_text:
            response.reason_phrase = 'INTERACTION NEEDED'

        if False:
            # TODO: set 6xx status
            pass
        else:
            # TODO: set 4NN Interaction Required status
            # TODO: set Linked-Interaction Header
            pass

        if self.status == self.STATUS_REDIRECT:
            response['Location'] = url
        else:
            self.update_header(response, request=request, url=url)

        return response.finalize_for(request)
