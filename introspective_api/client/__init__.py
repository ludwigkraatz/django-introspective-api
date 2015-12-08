import httplib2
from httplib2 import socks
from urllib import urlencode
import re
import json as simplejson

import hawk
from introspective_api.client.exceptions import *
from introspective_api.exceptions import ApiKeyNeedsRevalidation
from django.conf import settings as django_settings
from introspective_api.settings import api_settings
import datetime
dthandler = lambda obj: obj.isoformat() if isinstance(obj, datetime.datetime) else None

##
## TODO: run ntpd on Server!!!
##

class IntrospectiveApiResult(object):
    _exception_class = IntrospectiveApiClientException
    
    def __init__(self, client, body=None, header=None, url=None):
        self._client = client
        self._status = -1
        if header:
                            
            if 'content-type' in header:
                if header['content-type'].lower().startswith('application/json'):
                    self._body = simplejson.loads(unicode(body))
                else:
                    self._body = body
            else:
                self._body = body
            
            if 'status' in header:
                self._status = status = int(header['status'])
                self._handle_response_status(status)
        else:
            self._body = body
        self._header = header
        self._url = url
    
    def _handle_response_status(self, status):
        if status >= 500:
            raise self._exception_class(self)
        elif status >= 400:
            if status == 403:
                raise self._exception_class(self)
            elif status == 404:
                raise self._exception_class(self)
            elif status == 401:
                if self._body.get('code', "") == 'django-introspectiveapi-key-needs-revalidation':
                    raise ApiKeyNeedsRevalidation
            raise self._exception_class(self)
        elif status >= 300:
            pass
        #    if 'location' in header:
        #        self = client.get_result(absolute_url)
        elif status >= 200:
            pass
        else:
            raise self._exception_class(self)
    
        
    def was_successful(self):
        return self._status < 300 and self._status >= 200
        
    def get_result(self, name, method='GET'):
        
        if isinstance(name, basestring):
            if isinstance(self._body, basestring) and name in ['__unicode__', '__repr__', '__str__']:
                return getattr(name, self._body)
            elif isinstance(name, basestring) and isinstance(self._body, dict) and name in self._body:
                return self.__class__(self._client, self._body[name], None, url=self._url+name+'/')
        
        attr_lookup = None
        if isinstance(name, tuple):
            name, attr_lookup = name[0], name[1]
        
        if self._header and 'link' in self._header:
            if 'rel="related"; title="{attr}"'.format(attr=name) in self._header['link'] or \
                'rel="{attr}"'.format(attr=name) in self._header['link']:
            
                link_header_expr = r'<([a-zA-Z:/\-0-9\.?_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:_/\-?= ]*)",*)*'
                links = re.findall(link_header_expr, self._header['link'])
                wordings_url = None
                
                for group in links:
                    rel = group[2] if len(group)>=3 else  group[1];
                    if name == rel:
                        attr_url = group[0]
                        break
                    
                return self._client.get_result(absolute_url=attr_url, method=method)
        elif self._header and 'link-template' in self._header:
            if 'rel="related"; title="{attr}"'.format(attr=name) in self._header['link-template'] or \
                'rel="{attr}"'.format(attr=name) in self._header['link-template']:
            
                link_header_expr = r'<([a-zA-Z:/\-0-9\.?_={}]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:_/\-?= ]*)",*)*'
                links = re.findall(link_header_expr, self._header['link-template'])
                wordings_url = None
                
                
                #raise Exception, str(self._header['link-template'])
                
                for group in links:
                    if name == group[1] or (len(group)>2 and name == group[2]):
                        attr_url = group[0]
                        
                        attr_url = attr_url.format(**attr_lookup)
                        #link_template_expr = r'{%s}' % attr_name
                        #lookup = re.findall(link_template_expr, attr_url)
                        #if lookup:
                        #    attr_url = attr_url.replace('{%s}' % attr_name, attr_value)
                        break
                
                    
                return self._client.get_result(absolute_url=attr_url, method=method)
            
        elif not self.was_successful():
            pass  
        
        return self._client.get_result(absolute_url=self._url  + name + '/', method=method, data=attr_lookup)
    
    def __repr__(self):
        return unicode(self._body)
    
    def __getattr__(self, name):
        return self.get_result(name)
    
    def __iter__(self):
        if not isinstance(self._body, dict):
            raise self._exception_class(self, msg="'%s' is no dict" % str(self._body))
        return self._body.__iter__()
    
    def raw(self):
        return self._body
    
    def to_dict(self):
        if not isinstance(self._body, dict):
            raise self._exception_class(self, msg="'%s' is no dict" % str(self._body))
        return self._body
    
    def to_dict_with_meta(self, ):
        ret = {'__status': self._status}
        ret.update(self.to_dict())
        return ret
    
    

class IntrospectiveApiClient(object):
    _exception_class = IntrospectiveApiClientException
    
    _default_result_class = IntrospectiveApiResult
    _use_hawk_default = False
    
    def __init__(self, **kwargs):
        self._initkwargs = kwargs
        
        self._request = kwargs.get('request', None)
        
        self._protocol = 'HTTP' #  TODO HTTPS
        self._host = kwargs.get('host', None)
        self._root = kwargs.get('root', None)
        self._path = kwargs.get('path', [])
        self._language = kwargs.get('language', None)
        self._access_algorithm = kwargs.get('access_algorithm', 'sha256')
        self._access_id = kwargs.get('access_id', None)
        self._access_secret = kwargs.get('access_secret', None)
        self._use_hawk = kwargs.get('use_hawk', self._use_hawk_default)
        if self._use_hawk:
            if not (self._request and hasattr(self._request, 'api_user')):
                if not self._access_secret or not self._access_id or not self._access_algorithm:
                    raise self._exception_class(self, "accessId|Secret|Algorithm is missing")
            self._hawk_client = hawk.Client()
        else:
            self._hawk_client = None
        
        if 'results' in self._initkwargs:
            self._results = self._initkwargs['results']
        else:
            self._initkwargs['results'] = self._results = {None:self._default_result_class(client=self, url=self.full_url())}
    
    def was_successful(self):
        return self.execute().was_successful()
    
    def reset_complete(self):
        self._root = None
        return self.reset()
    
    def reset(self):
        self._path = None
    
    def clear(self):
        self._results = {None:self}
    
    def get_root(self, name):
        
        kwargs = self._initkwargs
        kwargs.update({'root': name})
        
        return self.__class__(**kwargs)
    
    def go(self, *names):
        return self.get(*names)
    
    def get(self, *names):
        
        kwargs = self._initkwargs
        
        path = kwargs.get('path', [])
        path.append({'get': names})
        kwargs.update({'path': path})
        
        return self.__class__(**kwargs)
    
    def post(self, *names):
        
        kwargs = self._initkwargs
        
        path = kwargs.get('path', [])
        path.append({'post': names})
        kwargs.update({'path': path})
        
        return self.__class__(**kwargs)
    
    def put(self, *names):
        
        kwargs = self._initkwargs
        
        path = kwargs.get('path', [])
        path.append({'put': names})
        kwargs.update({'path': path})
        
        return self.__class__(**kwargs)
    
    def execute(self):
        abstract_concat = None       
        for entry in self._path:
            
            method = entry.keys()[0]
            
            for name in entry[method]:
                
                str_name = str(name)
                if abstract_concat:
                    new_abstract_concat = '%s|%s' % (abstract_concat, str_name)
                else:
                    new_abstract_concat = str_name
                
                if new_abstract_concat not in self._results: # TODO better max Age a.s.o caching
                    self._results[new_abstract_concat] = self._results[abstract_concat].get_result(name, method=method.upper())
                
                abstract_concat = new_abstract_concat
        
        return self._results[abstract_concat]
    
    def execute_all(self):
        abstract_concat = None       
        for entry in self._path:
            
            method = entry.keys()[0]
            
            for name in entry[method]:
                
                str_name = str(name)
                if abstract_concat:
                    new_abstract_concat = '%s|%s' % (abstract_concat, str_name)
                else:
                    new_abstract_concat = str_name
                
                if new_abstract_concat not in self._results: # TODO better max Age a.s.o caching
                    self._results[new_abstract_concat] = self._results[abstract_concat].get_result(name, method=method.upper())
                
                abstract_concat = new_abstract_concat
        
        return self._results
    
    def get_result(self, path=None, absolute_url=None, method='GET', data=None):
        if path and not absolute_url:
            return self.get_result(path=path, absolute_url=self.full_url(path=path), method=method)
        elif not absolute_url:
            raise self._exception_class(self, 'missing argument "absolute_url"') # TODO
        
        try:
            data = simplejson.dumps(data, default=dthandler) if data else None
        except BaseException, e:
            raise self._exception_class(self, e)
        httplib2.debuglevel=4
        settings = {}
        if django_settings.DEBUG and api_settings.LOG_CLIENT and method != "PUT":# put causes error, because URL is inclomplete! (host missing)#Debug
            
            # httplib2 doesnt append host to URL on method != GET
            settings['proxy_info']  = httplib2.ProxyInfo(socks.PROXY_TYPE_HTTP_NO_TUNNEL, 'localhost', 7999)
            
        h = httplib2.Http(**settings)#".cache")#,
        
        headers = {'Content-Type': 'application/json; charset=UTF-8'}
        settings = {
            "uri":      absolute_url,
            "method":   method,
            "body":     data,
            "headers":  headers
        }
        
        if self._use_hawk:
            auth_header = self.get_auth_header(settings)
            headers.update({"Authorization": auth_header["field"]})
        
        if self._language:
            lang_header = {'Accept-Language': self._language}
            headers.update(lang_header)
            
        resp, content = h.request(** settings) #HEAD
        
        
        if self._use_hawk:
            self.authenticate_response(resp, content, auth_header)
            
        return self._default_result_class(client=self, body=content, header=resp, url=absolute_url)
        
    
    def get_credentials(self, ):
        if self._access_id and self._access_secret and self._access_algorithm:        
            return {
                'id': self._access_id ,
                'key': self._access_secret,
                'algorith': self._access_algorithm
                }
        if self._request is not None and hasattr(self._request, 'api_user'):
            return self._request.api_user.as_internal_credentials()
        return {
                'id': "",
                'key': "",
                'algorith': self._access_algorithm
                }
    
    
    def _get_response_dict(self, response, content):
        return {
                        'headers': response,
                    }
    def authenticate_response(self, respnse, content, auth_header):
        if not self._hawk_client.authenticate(
            response = self._get_response_dict(respnse, content),
            credentials =   self.get_credentials(),
            artifacts = auth_header["artifacts"],
            options={
                'payload': content
            }
            ):
            raise self._exception_class(self, 'Bad (not valid) Server Response')
    
    def get_auth_header(self, settings):
        options = {
            # auth
            'credentials':self.get_credentials(),
            
            # other
            'contentType': settings["headers"]["Content-Type"] if \
                            "Content-Type" in settings["headers"] else \
                            None,
            #TODO 'payload': unicode(settings.body)
            'ext': ''
        }
        header = self._hawk_client.header(
            url = settings["uri"],
            method = settings["method"],
            options = options
        )
        
        return header
    
    
    def to_python(self):
        return self.execute()
    
    def full_url(self, path = None):
        path = path if path else '/'.join(str(entry) for entry in self._path)
        return '{protocol}://{host}/api/{root}/{path}'.format(
                            protocol = self._protocol,
                            host = self._host,
                            root = self._root,
                            path = '' if not path else '%s/' % path
                            )
    
    
def getApiClient(*args, **kwargs):
    return IntrospectiveApiClient(*args, **kwargs)
