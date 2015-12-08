define(['jquery', 'introspective-api-resources', "introspective-api-log", "introspective-api-auth", 'introspective-api-utils', 'json'], function ($, apiResources, _log, AuthProvider, apiUtils, JSON2) {
    var ApiObject = apiResources.Object,
        ApiResult = apiResources.Result;
    function ApiClientEvent() {
        this.init.apply(this, arguments)
    }
    $.extend(ApiClientEvent.prototype, {
        init: function(name){
            this.name = name;
        }
    });
    var apiClientEvents = {
        
        // callback(event, id)
        'completed': {
            'succeeded': {},
            'failed': {},
        },
    }

    function ApiClient() {
        this.init.apply(this, arguments);
    };
    
    /* prototype extension */
    $.extend(ApiClient.prototype, {
        
        get_known_endpoints: function(){
            return this.getApiOptions().getResponse().endpoints
        },
        
        map_endpoint: function(request, settings){
            var endpoints = this.get_known_endpoints();
            var parsed = this.parseEndpoint(request.uri || request.url),
                root = this.root_url;
            
            if (root.indexOf(parsed.host) == -1) {
                root = '://' + parsed.host + root;
            }
            var url = request.url || (root + request.uri),
                endpoint = url.substr(url.indexOf(root) + root.length);
            if (endpoint.indexOf('/')) {
                endpoint = endpoint.substr(0, endpoint.indexOf('/'))
            }
            return endpoints[endpoint]
        },
        
        requires_auth: function(request, settings){
            endpoint = this.map_endpoint(request, settings)
            return endpoint ? endpoint.authenticated : true  // TODO? what if endpoint not found?
        },
        
        __setSpecialQueryParam: function(url, param, data){
            // TODO. WIP
            var prefix = '';
            if (this.api_options && this.api_options.query_param_prefix) {
                if (typeof(this.api_options.query_param_prefix) == 'object') {
                    if (this.api_options.query_param_prefix.hasOwnProperty(param)) {
                        prefix = this.api_options.query_param_prefix[param];
                    }else{
                        var keys = Object.keys(this.api_options.query_param_prefix);
                        for (var i=0; i < keys.length; i++) {
                            if (this.api_options.query_param_prefix[keys[i]] == param) {
                                prefix = keys[i];
                                break;
                            }
                            if (typeof(this.api_options.query_param_prefix[keys[i]]) == 'object' && this.api_options.query_param_prefix[keys[i]].indexOf(param) !== -1) {
                                prefix = keys[i];
                                break;
                            }
                        }
                    }
                }else{
                    prefix = this.api_options.query_param_prefix;
                }
            }
            if (url.indexOf('?') == -1) {
                url += '?';
            }else{
                url += '&';
            }
            return url + prefix + type + '=' + data
        },
        
        is_restricted: function(request, settings){
            endpoint = this.map_endpoint(request, settings)
            return endpoint ? endpoint.restricted : true  // TODO? what if endpoint not found?
        },

        is_locked: function(request, settings){
            if (this.locked_restricted && this.is_restricted(request, settings)) {
                return true  // TODO
            }
            if (this.locked_authenticated && this.requires_auth(request, settings)) {
                return false  // TODO
            }
            
            return this.locked
        },
        
        lock: function(type){
            if (!type) {
                this.locked = true;
                return
            }
            if (type == 'authenticated') {
                this.locked_authenticated = true;
                return
            }
            if (type == 'restricted') {
                this.locked_restricted = true;
                return
            }
            throw Error('not implemented')
        },
        
        unlock: function(request, settings, result){
            if (request === settings === result === undefined) {
                this.locked = false;
                return
            }
            if (settings.sendAuth && settings.isApiInternal) {
                this.locked_authenticated = false;
                return
            }
            this.locked_restricted = false;
            return
        },
        
        syncTimestamp: function(request, settings, response){
            if (settings.host && settings.host.setTimestampOffset) {
                if (response.ts || response.timestamp) {
                    var ts;
                    if (settings && settings.ts) {
                        ts = settings.ts
                    }else{
                        ts = this.getTimestamp();
                    }
                    settings.host.setTimestampOffset((response.ts || response.timestamp) - ts)
                }else{
                    throw Error('cannot sync timestamp because couldnt find it in response', settings)
                }
            }else{
                throw Error('cannot sync timestamp for undefined host', settings)
            }
        },

        _registeredHandlers: {
            201:{
                'CREATED': {
                    'obj': null,
                    'callback': function(context){
                        return context.methodMap.proceedSuccess()
                    }
                },
            },
            400:{
                'HAWK TIMESTAMP OUT OF SYNC': {
                    'obj': null,
                    'callback': function(context){
                        context.apiClient.syncTimestamp(context.request, context.settings, context.response)
                        return context.methodMap.repeatRequest();
                    }
                },
            },
            401:{
                'AUTHENTICATION EXPIRED': {
                    'obj': null,
                    'callback': function(context){
                        if (!context.apiClient.locked_authenticated) {
                            if (context.apiClient.debug_level > 0) {
                                _log(context.log, 'debug', ['locked, because not authenticated']);
                            }
                            context.apiClient.lock('authenticated');
                            context.apiClient.refreshCredentials({
                                callback: context.methodMap.processInteraction,
                                expectsResult: true,
                                forceRefresh: true
                            });
                        }
                        return context.methodMap.deferRequest();
                    }
                },
                'AUTHENTICATION MISSING': {
                    'obj': null,
                    'callback': function(context){
                        if (!context.apiClient.locked_authenticated) {
                            if (context.apiClient.debug_level > 0) {
                                _log(context.log, 'debug', ['locked, because not authenticated']);
                            }
                            context.apiClient.lock('authenticated');
                            /*context.apiClient.refreshCredentials({
                                callback: context.methodMap.processInteraction,
                                expectsResult: true,
                                forceRefresh: true
                            });*/
                        }
                        return context.methodMap.deferRequest();
                    }
                },
                //'consumer missing': function(context){
                //},
            },
        },
        
        api_options: undefined,

        getApiOptions: function(callback){
            
            var $this = this;
            if (!this.api_options) {
                if (callback == undefined) {
                    _log(this.__log, 'error', ['api endpoint wasn\'t initialized and no callback given']);
                    throw Error('api endpoint wasnt initialized and no callback given');
                }
                this.add_urgent({
                    uri: '/',
                    type: 'OPTIONS',
                    ignoreLock: true,
                    raw: true,
                    isApiInternal: true,
                    done: function(result){
                        $this.api_options = result;
                        callback($this.api_options);
                    }
                })
                return false;
            }
            else{
                if (callback == undefined) {
                        return this.api_options
                    }
                callback(this.api_options);
                return true;    
            }
        },
        
        getSitemap: function(callback){
            if (callback) {
                return this.getApiOptions(function(options){
                    callback(options.getContent().links)
                })
            }
            return this.getApiOptions().getContent().links
        },
        
        initialize: function(callback){
            this.getSitemap(function(){
                if (callback){
                    callback();
                }
            })
        },
        
        setLanguage: function(languageCode){
            this.default_headers['Accept-Language'] = languageCode;
        },
        
        
        getProtocol: function(settings){
            return 'http://' // 'https://'
        },
        
        getTimestamp: function(host){
            var ts = Math.round(+new Date()/1000);
            if (host && host.fixTimestamp) {
                return host.fixTimestamp(ts);
            }
            return ts;
        },
        
        ajax_apiInternal: function( ajax, ajax_settings, id){
            process_data = true;
            // signing the request if accessId available
            if (ajax_settings.auth && typeof(ajax_settings.auth.isAuthenticated)=='function') {
                var is_authenticated = ajax_settings.auth.isAuthenticated(ajax_settings.host);
                if (is_authenticated) {
                    process_data = false;
                    ajax = ajax_settings.auth.sign('jQuery', {'request': ajax, 'settings': ajax_settings});
                }else if (is_authenticated === undefined && ajax_settings.sendAuth !== true && this.requires_auth(ajax, ajax_settings)){
                    auth_id = ajax_settings.auth.refresh(ajax_settings.host, ajax_settings);
                    this.defereRequest(id, auth_id)
                    return undefined
                }
            }else if (ajax_settings.auth && (ajax_settings.auth.accessId || ajax_settings.auth.profileId)) {
                ajax_settings.auth.validateResponse = true;
                ajax = AuthProvider.sign_jQueryRequest(ajax, ajax_settings);
            }
            if ((!ajax.dataType || ajax.dataType == 'json') && !ajax.headers.Accept) {
                $.extend(ajax.headers, {
                    "Accept": 'application/json'
                }); 
            }
            if (process_data && ['post', 'patch', 'put'].indexOf(ajax.type.toLowerCase()) != -1 && ((ajax.dataType == 'json' || ajax.data instanceof Object) && (typeof(ajax.data) == 'object'))){
                ajax.data = JSON.stringify(ajax.data);
                ajax.contentType = 'application/json; charset=utf-8';
                delete ajax.dataType;
            }
            
            if (this.consumerToken) {
                $.extend(ajax.headers, {
                    "Consumer-Token": typeof(this.consumerToken) == 'function' ? this.consumerToken() : this.consumerToken
                }); 
            }
            if (this.requiresCSRFToken(ajax, ajax_settings)) {
                var csrf_token = this.csrftoken;
                if (typeof(csrf_token) == 'function') {
                    csrf_token = csrf_token();
                }
                
                if (csrf_token) {
                    $.extend(ajax.headers, {
                        "CSRF-Token": csrf_token
                    }); 
                }
                
            }
        
            
            if (this.debug_level > 0)
                // TODO: don't log accessSecret
                _log(ajax_settings.log || this.__log, 'debug', ['(info)', '[Introspective ApiClient]', 'request:', ajax, 'with settings', ajax_settings]);
            
            
            var jqxhr = this.ajax(ajax, id);
            
            if (ajax_settings.auth && ajax_settings.auth.validateResponse) {
                jqxhr.done(function(response, status, xhr){
                    if (ajax_settings.auth.ensure_validation) { // TODO: validate allways, not just on done()?
                        ajax_settings.auth.ensure_validation('jQuery', {'xhr': xhr, 'settings': ajax_settings})
                    }else{
                        ajax_settings.auth.responseValid = AuthProvider.validate_jQueryXHR(xhr, ajax_settings);
                    }
                }) 
            }
            
            jqxhr.url = ajax.url;
            
            return jqxhr;
        },
        
        registerCallbacksForRequest: function(id, callbacks){
            if (this.queue[id] === undefined) {
                _log(this.__log, 'error', [ '[Introspective ApiClient]', 'id "'+id+'" not found in queue']);
                return false;
                throw Error('id "'+id+'" not found in queue')
            }
            if (this.queue[id]['callbacks'] === undefined) {
                this.queue[id]['callbacks'] = {};
            }
            for (var callback in callbacks) {
                if (this.queue[id]['callbacks'][callback] === undefined){
                    this.queue[id]['callbacks'][callback] = []
                }
                this.queue[id]['callbacks'][callback].push(callbacks[callback]);
            }
            return true
        },
        
        ajax: function(request, id){
            return $.ajax(request)
        },
    
        parseEndpoint: function(endpoint){ // TODO: in the hawk lib is a nice regex
            var tmp = endpoint.split('://'),
                host,
                endpoint,
                protocol;
            if (tmp.length == 1) {
                tmp = tmp[0];
                protocol = null;
            }else{
                tmp = tmp[1];
                protocol = tmp[0];
            }
            var tmp2 = tmp.split("/");

            if (tmp2[0] == '') {
                host = window.location.hostname + (window.location.port ? ':' + window.location.port: '');
            }else {
                host = tmp2[0];
                delete tmp2[0];
            }
            endpoint = tmp2.join('/');
            if (endpoint[endpoint.length -1] == '/') {
                endpoint = endpoint.slice(0, - 1);
            }
            return {
                host: host,
                endpoint: endpoint,
                protocol: protocol
            }
        },
        
        __reset: function(){      
            this.counter = 0;
            this.max_priority = 4;
            this.at_once = 5;
            this.active = 0;
            this.priotirized_requests = {
                    0:[],
                    1:[],
                    2:[],
                    3:[],
                    4:[]
            };
            this.priotirized = false;
            this.queue = {};
            this.dependencies = {};
            this.is_active = {};
            this.deferredQueue = [];  // after lock()
            this.deferredLookup = {};
            
            this.sitemap = null;
            this.endpoint = null;
            
            this.additional_headers = [];
            this.default_headers = [];
            this.crossDomain = null;
            
            this.locked_restricted = false;
            this.locked_authenticated = false;
            this.locked = false;
            this.running = false;
            this.consumerToken = null;
            this.csrftoken = null;    
            
            this.debug_level = 1;
            this.authentication_url = null;
        },
    
        init: function(settings){
            this.__reset()
            this.__event_handler = {};
            this.__log = settings.log;
            this.host = settings.host || this.host;
            this.cache = settings.cache;
            if (this.host) {
                this.crossDomain = this.host.isCrossDomain();
                this.root_url = this.host.get_root()
                this.consumerToken = this.host.getConsumerToken.bind(this.host);
                this.csrftoken = this.host.getCSRFToken.bind(this.host);
            }else{
                var endpoint = this.parseEndpoint(settings.endpoint)
                this.root_url = settings.endpoint;
                this.host = endpoint.host;
                this.endpoint = endpoint.endpoint;
                this.protocol = endpoint.protocol;
                this.crossDomain = settings.crossDomain;
                this.consumerToken = settings.consumerToken;
            }
            _log(this.__log, 'debug', ['(init)', '[Introspective ApiClient]', 'settings:', settings, 'host:', this.host, this]);
            
            
            
            //if (!(this.consumerToken || this.csrftoken)) {
            //    cookie  = this.getCookie('consumerToken');
            //    if (!this.crossDomain || cookie === undefined){
            //        cookie  = this.getCookie('csrftoken');
            //        if (cookie == undefined){
            //            alert("NO COOKIES FOUND. Frontend not valid.");
            //            this.lock();
            //        }else{
            //            this.csrftoken = cookie;
            //        }
            //        
            //    }else{
            //        this.consumerToken = cookie;
            //    }
            //}
            if (!this.consumerToken) {
                cookie  = this.getCookie('consumerToken');
                if (cookie){
                    this.consumerToken = cookie;
                }
            }
            if (!this.crossDomain){
                this.updateCSRFToken();
            }
        },
        
        getCache: function(){
            return this.cache
        },
        
        updateCSRFToken: function(result){
            if (!result) {
                cookie  = this.getCookie('csrftoken');
                if (cookie){
                    this.csrftoken = cookie;
                }
            }
        },
        
        requiresCSRFToken: function (request, settings) {
            // these HTTP methods do not require CSRF protection
            if (/^(GET|HEAD|OPTIONS|TRACE)$/.test(request.type.toUpperCase())){
                return false;
            };
            if (settings && settings.auth && (typeof(settings.auth.isAuthenticated) != 'function' || settings.auth.isAuthenticated(settings.host))) {
                return false
            }
            return true
        },
    
        /*
         * If one is not logged in but authorized for a specific action, the
         * authorization token needs to be transmitted. it can be set with this
         * function.
         */
        setHeader: function(header, token){
            var entry       =   {};
            entry[header]   =   token;
            $.extend(this.additional_headers,entry);
        },    
        
        getCookie: function(name) {
            var cookieValue = null;
            if (document.cookie && document.cookie != '') {
                var cookies = document.cookie.split(';');
                for (var i = 0; i < cookies.length; i++) {
                    var cookie = $.trim(cookies[i]);
                    // Does this cookie string begin with the name we want?
                    if (cookie.substring(0, name.length + 1) == (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        },
        
        /*
         * add urgent means with priority 0
         */
        add_urgent: function(request, settings, id){
            if (!settings)
                settings={}
            $.extend(settings,{'priority':0});
            return this.add(request, settings);      
        },
        
        get_id: function(request, settings){
            if (request.id) {
                return request.id
            }
            this.counter+=1;
            return "counted_"+this.counter
        },
    
        /*
         * specify an $.ajax(request), an id of this request for the queue and settings about what to do on adding an request with same id e.g.
         * settings:
         *      dependency: helps to not execute requests, after a third object had been abortet or updated
         *      priority:   from 0-max_priority
         */
        add: function (request, settings, id){
            var resolve_endpoint = false;

            if (id==undefined){
                id= this.get_id(request, settings)
            } 
            if (settings){
                var priority=settings['priority']
                if (settings['dependency'])
                    {
                        if (!this.dependencies[settings['dependency']])
                            this.dependencies[settings['dependency']]=[]
                        this.dependencies[settings['dependency']].push(id)
                    }
            }else{
                settings={}
            }
            if (request.addCsrfHeader != undefined) {
                settings.addCsrfHeader = request.addCsrfHeader
                delete request.addCsrfHeader
            }
            if (request.done != undefined) {
                settings.done = request.done
                delete request.done
            }
            if (request.ignoreLock != undefined) {
                settings.ignoreLock = request.ignoreLock
                delete request.ignoreLock
            }
            if (request.cache != undefined) {
                settings.cache = request.cache
                delete request.cache
            }
            if (request.source != undefined) {
                settings.source = request.source
                delete request.source
            }
            if (request.signPayload != undefined) {
                settings.signPayload = request.signPayload
                delete request.signPayload
            }
            if (request.uri && !request.url) {
                request.isApiInternal = true  // TODO: if this.endpoint
            }
            if (request.isApiInternal != undefined) {
                settings.isApiInternal = request.isApiInternal
                delete request.isApiInternal;
                
                if (settings.isApiInternal) {
                    settings.auth = settings.auth || request.auth || {};
                    delete request.auth;
                    if (!settings.auth) {
                        this.patchAuth(settings);
                    }
                }
            }
            if (request.auth) {
                settings.auth = request.auth ;
                delete request.auth;
            }
            if (request.raw !== undefined) {
                settings.raw = request.raw ;
                delete request.raw;
            }
            if (request.log !== undefined) {
                settings.log = request.log ;
                delete request.log;
            }
            
            if (request.fail != undefined) {
                settings.fail = request.fail
                delete request.fail
            }
            
            if (this.dependencies[id]){ // abort dependencies that are registered for this request id - e.g. for recurrent requests
                this.abortDependencies(id)  // TODO: this needs to be clarified... ??
            }
            if (priority==undefined)
                priority=this.max_priority

            if (this.queue[id]!=undefined){
                if (this.queue[id].priority<priority)
                    delete this.priotirized_requests[priority][$.inArray(id,this.priotirized_requests[priority])]
            }
            
            if (typeof(this.host) != 'string') {
                this.host.prepareRequest('jQuery', request, settings);
            }
            
            if (request.endpoint) {
                resolve_endpoint = typeof(request.endpoint) == 'object' ? request.endpoint : false;
                if (!resolve_endpoint) {
                    throw Error('not implemented')
                }
            }
            
            if (settings.isApiInternal) {
                var $this = this,
                    uri = true,
                    ajax = {
                        "global": false,
                        "headers": {},
                    };;
                    
                settings.host = this.host;
                if (typeof(this.host) != 'string') {
                    // request was prepared by the host. so skip it now
                    uri = false;
                }else{
                    ajax.url = request.uri ? (this.endpoint + (request.uri[0] != '/' ? '/' : '') + request.uri) : request.url,
                    prefix = this.getProtocol(settings) + this.host + this.endpoint
                    if (ajax.url.indexOf(prefix) == 0) {
                        uri = false;
                    }else if (ajax.url.indexOf('://') != -1) {
                        throw Error('not allowed')
                    }
                    
                    delete request.uri;
                }
                
                
                $.extend(ajax.headers, this.default_headers);
                $.extend(ajax, request);
                if (settings.headers) {
                    $.extend(ajax.headers, settings.headers);
                }
                $.extend(ajax.headers, this.additional_headers);
                
                
                if (this.crossDomain) {
                    ajax.crossDomain = true;
                }
                if (uri) {
                    ajax.url = this.host + ajax.url;
                    
                    ajax.url = this.getProtocol(settings) + ajax.url;
                }
                ajax.base_url = request.base_url;
                ajax.uri = request.uri;
                request = ajax;
            }
            var result = new ApiResult({apiClient: this, url: request.url, raw: settings.raw, log: settings.log || this.__log});
            result.registerRequest(id, request, settings);
            this.queue[id]={
                'settings':settings,
                'request':request,
                'callbacks': {},
                'result': result
            }
            var cache = this.getCache();
            if (settings.cache !== false && cache) {
                var cached = cache.handle(this.queue[id]);
                if (cached) {
                    result.wasCached.apply(result, cached)
                    throw Error('TODO: implement this.complete(id) from cached')
                }
            }

            /*
            if (this.active<this.at_once){
                this.start(id);
            }else{
                if (!this.priotirized_requests[priority])
                    alert(priority)
                this.priotirized_requests[priority].push(id)
            }
            */
            if (resolve_endpoint) {
                this.resolve_url($.extend({}, resolve_endpoint, {callback: function(id, priority, superCallback, url){
                        // TODO: get the host not from request.url
                        this.queue[id].request.url = (this.queue[id].request.base_url || this.queue[id].request.url) + url + (this.queue[id].request.uri && this.queue[id].request.uri != '/' ? this.queue[id].request.uri : '');
                        this._schedule(id, priority)
                        if (superCallback) {
                            superCallback(url)
                        }
                    }.bind(this, id, priority, resolve_endpoint.callback)
                }))
            }else{
                this._schedule(id, priority)
            }
            
            
            return id;
           },

        _schedule: function(id, priority){
            var request = this.queue[id].request,
                settings = this.queue[id].settings;
            if (priority === undefined) {
                priority = 0
            }

            if (((this.active<this.at_once && priority == 0)
                || !this.priotirized
            ) && !this.is_locked(request, settings)) {
                this.start(id);
            }else{
                if (!this.priotirized_requests[priority]){
                    _log(settings.log || this.__log, 'error', [priority, 'is not a valid priority']);
                    throw new Error(str(priority) + 'is not a valid priority')
                }
                this.priotirized_requests[priority].push(id)
                
                if (this.active<this.at_once && !this.is_locked(request, settings)){ // TODO: as complete callback of active requests
                    var $this = this;
                    setTimeout(function (){$this.next()}, 10);
                }
            }
        },
    
        /*
         * start next highest request
         */
        next:function (){
            for (var i=0;i<=this.max_priority;i++){
                while (this.active<=this.at_once && this.priotirized_requests[i].length>0){
                    cur = this.priotirized_requests[i][this.priotirized_requests[i].length-1]
                    if (!this.is_locked(this.queue[cur].request, this.queue[cur].settings)) {
                        this.start(this.priotirized_requests[i].pop())
                    }else{
                        break; // TODO: find a better way. now ignoreLock requests get missed, because they might not be the latest request
                    }
                }
                if (this.priotirized_requests[i].length>0)
                    break;
            }   
            
        },
    
        /*
         * aborts dependend requests on e.g. abortion of the related request
         */
        abortDependencies: function (id){
            var queued_ajax=this
            $.each(this.dependencies[id],function(key,value){
                queued_ajax.abort(value)
            })
            this.dependencies[id].length=0
        },
    
        /*
         * aborts request defined by id
         *      aborts dependencies afterwards if existend if specified in settings or
         *      lowers the priority of related requests - used e.g. if it needs to be loaded in every case but its not so urgent any more
         */
        abort: function (id){
            if (!this.queue[id])
                return false;
            if (this.queue[id].settings.removeOnAbort)
            {
                if (this.queue[id].jqXHR)
                    this.queue[id].jqXHR.abort()
                else{
                    var priority=this.queue[id].settings.priority
                    delete this.priotirized_requests[priority][$.inArray(id,this.priotirized_requests[priority])]
    
                    if (this.dependencies[id])
                        this.abortDependencies(id)
    
                    delete this.queue[id]
                }
            }else if(this.queue[id].settings.lowerOnAbort){
                var settings=$.extend(true,{},this.queue[id].settings,{priority:undefined})
                this.start(this.queue[id],id,settings)
            }
            return true;
        },
        /*
         * really starts the ajax request matching the id
         */
        start:function (id){
            // if id has been removed from entry meanwhile, start next
            if (!this.queue[id])
                return this.next()
    
            this.active+=1;
    
            this.queue[id]["settings"]['ts'] = this.getTimestamp(this.queue[id]["settings"].host);

            var request =   $.extend({}, this.queue[id]["request"]),
                settings =  $.extend({}, this.queue[id]["settings"]);
            var $ajax;
            
            if (settings.isApiInternal === true) {
                $ajax = this.ajax_apiInternal(request, settings, id)
            }else{
                $ajax = this.ajax(request, id);
            }
            if (!$ajax) {
                return null
            }
            this.queue[id]["jqXHR"]=$ajax;
            
            /*$ajax.then(
                this._get_done_handler(id),
                this._get_fail_handler(id)
            )*/
            //$ajax.success(this._get_done_handler(id));
            //$ajax.error(this._get_fail_handler(id));
            $ajax.always(this._get_handler(id));
            
            return $ajax
        },
        
        get_queue:function(){
            return this.queue
        },
        
    
        /*
         * event handler for triggering
         */
        __trigger: function (event_name, args) {
            var event = new ApiClientEvent(event_name);
            var event_args = new Array();

            event_args.push(event);
            for (var arg in args) {
                event_args.push(args[arg]);
            }
            if (this.__event_handler.hasOwnProperty(event_name)) {
                for (var i = 0; i < this.__event_handler[event_name].length; ++i) {
                   try {
                       this.__event_handler[event_name][i].apply(null, event_args);
                   } catch (e) {
                       _log(this.__log, 'error', ['could not execute event "'+ event_name +'"', event, 'callback:', this.__event_handler[event_name][i], 'got error:', e])
                   }
                }
            }
        },
        
        __bind: function (event, callback) {
            var $this = this;
            if (event.slice(-1) == '*') {
                var event_prefix = event.slice(0,event.length-1),
                    prefix_length = event_prefix.length;
                if (apiClientEvents.hasOwnProperty(event_prefix)) {
                    this.__bind(event_prefix, callback);
                    function onChildren(container, __event) {
                        for (var _event in container[__event]){
                            $this.__bind(_event, callback);
                            onChildren(container[__event], _event);
                        }
                    }
                    onChildren(apiClientEvents, event_prefix)
                }else{
                    for (var _event in apiObjectEvents) {
                        if (event_prefix == _event.slice(0, prefix_length)) {
                           this.__bind(_event, callback)
                        }
                    }
                }
            }else{
                if (!this.__event_handler.hasOwnProperty(event)) {
                    this.__event_handler[event] = [];
                }
                this.__event_handler[event].push(callback);
            }
        },
    
        /*
         * function that is a wrapper to do some organizational stuff for queued_ajax and afterwards the complete function of the ajax request
         */
        _complete: function(id){
            var $this=this;
                entry = $this.queue[id],
                cache = this.getCache();
                
                if (entry.settings.cache !== false && cache) {
                    cache.process(entry);
                }
                //if ($this.queue[id].settings.source && $this.queue[id].settings.source.apply) {
                //    $this.queue[id].settings.source.apply(undefined, undefined, true)
                //}
                delete $this.queue[id]
    
                $this.next()    
        },
        
        translateResponse_toJSON: function(jqXHR){
            try {
                return jqXHR.responseText ? JSON.parse(jqXHR.responseText) : {};
            } catch(e) {
                responseHTML = jqXHR.responseText ? $(jqXHR.responseText) : null;
                responseJSON = {}; // TODO: make the classes dynamic
                if (responseHTML != null && responseHTML.hasClass("expn-error")) {
                    responseJSON.msg = responseHTML.find('.expn-msg').html();
                    responseJSON[expnConsts.expnResponse_expnCode_attrName] = responseHTML.find('.expn-code').html();
                    responseJSON.detail = responseHTML.find('.expn-detail').html();
                    responseJSON.html = jqXHR.responseText;
                }
                return responseJSON
            }
            return {}
            
        },
            
        _getFailedCallbackHandler: function(id) {
            var apiClient = this;
            return function (jqXHR, statusText, error){
                var result = apiClient.queue[id].result;
                result.registerFailure(error, statusText, jqXHR);
                
                if (this.deferredQueue.indexOf(id) != -1) {
                    this.deferredQueue.splice(this.deferredQueue.indexOf(id), 1);
                }
                
                var method = apiClient.queue[id].settings.fail;
                if (method != undefined){
                    method(result)
                }
                for (var entry in apiClient.queue[id].callbacks.fail) {
                    apiClient.queue[id].callbacks.fail[entry](result)
                }
                for (var entry in apiClient.queue[id].callbacks.always) {
                    apiClient.queue[id].callbacks.always[entry](result)
                }
                for (var entry in apiClient.queue[id].callbacks.then) {
                    apiClient.queue[id].callbacks.then[entry](result)
                }
                method = apiClient.queue[id].settings.always;
                if (method != undefined){
                    method(result)
                }
                
                this.__trigger('failed', [id]);
                return apiClient._complete(id);
            }            
        },
        
        _getSuccessCallbackHandler: function(id, methodMap) {
            var apiClient = this;
            return function (response, statusText, jqXHR){
                var result = apiClient.queue[id].result;
                if ((!apiClient.queue[id].settings.auth || apiClient.queue[id].settings.auth.validateResponse != true) ||
                    apiClient.queue[id].settings.auth.responseValid) {

                    result.registerSuccess(response, statusText, jqXHR);
                    
                    var method = apiClient.queue[id].settings.done;
                    if (method != undefined){
                        method(result)
                    }   
                    for (var entry in apiClient.queue[id].callbacks.done) {
                        apiClient.queue[id].callbacks.done[entry](result)
                    }
                    for (var entry in apiClient.queue[id].callbacks.always) {
                        apiClient.queue[id].callbacks.always[entry](result)
                    }
                    for (var entry in apiClient.queue[id].callbacks.then) {
                        apiClient.queue[id].callbacks.then[entry](result)
                    }   
                    method = apiClient.queue[id].settings.always;
                    if (method != undefined){
                        method(result)
                    }
                    this.__trigger('succeeded', [id]);
                    return apiClient._complete(id);
                    
                }else{                
                    result.registerFailure(response, statusText, jqXHR);
                    _log(apiClient.queue[id].settings.log || this.__log, 'error', ['(IntrospectiveApi)', '(Response)', 'response not valid'])
                    return methodMap.proceedFailure(jqXHR, "Response not valid", 0);
                    
                }            

            }
        },
        
        registerExternalHandlers: function(obj, handlerMap){
            var newHandlers = {};
            for (var status in handlerMap) {
                if (status == '*') {
                    newHandlers[status] = {
                        obj: obj,
                        callback: handlerMap[status]
                    }
                }else{
                    for (var statusText in handlerMap[status]) {
                        if (newHandlers[status] == undefined) {
                            newHandlers[status] = {};
                        }
                        
                        newHandlers[status][statusText] = {
                            obj: obj,
                            callback: handlerMap[status][statusText]
                        }
                    }   
                }

            }
            $.extend(this._registeredHandlers, newHandlers);
        },
        
        defereRequest: function(id, dependency){
            if (!dependency) {
                return this.deferredQueue.push(id);
            }
            if (!this.deferredLookup[dependency]) {
                this.deferredLookup[dependency] = [];
            };
            this.deferredLookup[dependency].push(id);
        },
        
        _get_handler: function(id){
            var apiClient = this;
            
            var methodMap = {};
            var request = apiClient.queue[id].request,
                request_settings = apiClient.queue[id].settings,
                result = apiClient.queue[id].result;
            
            methodMap.proceedFailure = apiClient._getFailedCallbackHandler(id, methodMap);
            methodMap.proceedSuccess = apiClient._getSuccessCallbackHandler(id, methodMap);

            methodMap.processInteraction = function (result){
                // TODO this is not just a method for 401 interactions. make this more appropriate..
                if (result) {
                    apiClient.unlock(apiClient.queue[id].request, apiClient.queue[id].settings, result);
                    $.each(apiClient.deferredQueue, function(index, id){
                        if (apiClient.queue[id].settings.isApiInternal){
                            apiClient.patchAuth(apiClient.queue[id].settings, request_settings.auth)
                        }
                    })
                    apiClient.handleDeferredRequests(id);
                }else{
                    _log(request_settings.log || this.__log, 'error', ['(IntrospectiveApi)', '(processInteraction)', 'result is ', result])
                    methodMap.proceedFailure();
                }
            };
                
            methodMap.repeatRequest = function (retryAfter) {
                if (!retryAfter) {
                    return apiClient.start(id);
                }
                setTimeout(apiClient.start, parseInt(retryAfter)*1000, id);
            };
                
            methodMap.deferRequest = function(){
                apiClient.deferredQueue.push(id);
            }
            
            return function(jqXHR_response, textStatus, error_jqXHR){
                var jqXHR, code;
                if (textStatus == 'success') {
                    methodMap.proceedSuccess = methodMap.proceedSuccess.bind(apiClient, jqXHR_response, textStatus, error_jqXHR);
                    methodMap.proceedFailure = methodMap.proceedFailure.bind(apiClient, error_jqXHR, textStatus, jqXHR_response);
                    proceed = methodMap.proceedSuccess;
                    jqXHR = error_jqXHR;
                    code = '';
                }else{
                    methodMap.proceedSuccess = methodMap.proceedSuccess.bind(apiClient, error_jqXHR, textStatus, jqXHR_response);
                    methodMap.proceedFailure = methodMap.proceedFailure.bind(apiClient, jqXHR_response, textStatus, error_jqXHR);
                    proceed = methodMap.proceedFailure;
                    jqXHR = jqXHR_response;
                    code = error_jqXHR;
                }
                
                apiClient.active-=1;
                
                var status = jqXHR.status;
                result.registerXhr(jqXHR);
                var context ={
                    result: result,
                    request: request,
                    settings: request_settings,
                    response: apiClient.translateResponse_toJSON(jqXHR),
                    jqXHR: jqXHR,
                    code: code,
                    
                    apiClient: apiClient,
                    methodMap: methodMap,
                    auth: request_settings.auth,
                    source: request_settings.source
                    
                }
                
                if (apiClient._registeredHandlers[status] != undefined) {
                    
                    if (apiClient._registeredHandlers[status][code] != undefined){
                        context.this = apiClient._registeredHandlers[status][code]['obj']
                        return apiClient._registeredHandlers[status][code]['callback'](context);
                    
                    }else if (apiClient._registeredHandlers[status]['.'] != undefined) {
                        context.this = apiClient._registeredHandlers[status]['.']['obj']
                        return apiClient._registeredHandlers[status]['.']['callback'](context);
                    
                    }
                }
                
                // if no registered handler for this state was found, proceed either simple success or faliure
                return proceed()
            }
        },
        
        handleDeferredRequests: function(){
            $.each(this.deferredQueue, function(index, id){
                if (!this.is_locked(this.queue[id].request, this.queue[id].settings)) {
                    this.start(id)  // TODO: do it with priorities
                }
                
            }.bind(this))
        },
        
        patchAuth: function(settings, auth){
            if (settings.auth) {
                return true
            }
            if (auth) {
                settings.auth = auth;
                return true
            }
            if (settings.auth === undefined) {
                settings.auth = {};
            }
            throw Error('TODO: implement client.patchAuth()');
            settings.auth.profileId = settings.auth.profileId || this.profileId;
            settings.auth.accessId = settings.auth.accessId || this.accessId;
            settings.auth.accessSecret = settings.auth.accessSecret || this.accessSecret;
            settings.auth.accessAlgorithm = settings.auth.accessAlgorithm || this.accessAlgorithm;
            return true
        },
        
        setCredentials: function(response) {    
            throw Error('TODO: implement client.setCredentials()');            
                this.accessId = response.accessId;
                this.accessSecret = response.accessSecret;
                this.accessAlgorithm = response.accessAlgorithm;
                
        },
        
        resolve_url: function(settings){
            var target = settings.target,
                type = settings.type,
                callback = settings.callback;

            return this.getApiOptions(function(result){
                    var links = result.getHeaderLinks(),
                        url_done = false,
                        url;
                    if (links[target]) {  // TODO: check type
                        url = links[target];
                        url_done = true;
                    }else if (links[type]) {  // TODO: ... not right this way
                        //throw Error()
                        url = links[type]
                    }
                    if (!url_done){
                        var sitemap = this.getSitemap(),
                            uri;
                        if (url) {
                            uri = url.replace(sitemap['.'], '')
                        }console.log(url, sitemap)
                        if (sitemap[target]) {
                            url = sitemap[target]['.'];
                            url_done = true;
                        }else if (sitemap[type] || (uri && sitemap[uri])) {
                            type_sitemap = sitemap[type] || (uri && sitemap[uri])
                            if (type_sitemap[target]) {
                                url = type_sitemap[target]['.'];
                                url_done = true;
                            }else{
                                this.add_urgent({
                                        uri: type_sitemap['.'],
                                        type: 'OPTIONS',
                                        ignoreLock: settings.ignoreLock,
                                        raw: true,
                                        isApiInternal: true,
                                        done: function(result){
                                            var links = result.getHeaderLinks();
                                            if (links[target]) {
                                                callback(links[target])
                                            }else{
                                                throw Error('couldnt find "'+target+'" url');
                                            }
                                        }.bind(this),
                                        fail: function(){
                                            throw Error('couldnt find "'+target+'" url');
                                        }
                                    })
                                return false;
                            }
                        }
                    }
                    if (!url_done) {
                        throw Error('couldnt find "'+target+'" url');
                    }
                    callback(url)
                }.bind(this))
        },
        authentication_url: null,
        getAuthenticationURL: function(callback){
            if (!this.authentication_url) {
                if (!callback) {
                    throw Error('no authentication url known. provide callback, so that discovering can be done')
                }

                this.resolve_url({
                    'target': 'login',
                    'type': 'auth',
                    'callback': function(url){
                        this.authentication_url = url;
                        callback(url)
                    }.bind(this),
                    ignoreLock: true
                })
                return false
            }
            if (callback) {
                callback(this.authentication_url)
                return true
            }
            return this.authentication_url
        },
        logout_url: null,
        getLogoutURL: function(callback){
            if (!this.logout_url) {
                if (!callback) {
                    throw Error('no logout url known. provide callback, so that discovering can be done')
                }

                return this.resolve_url({
                    'target': 'logout',
                    'type': 'auth',
                    'callback': function(url){
                        this.logout_url = url;
                        callback(url)
                    }.bind(this),
                    ignoreLock: true
                })
            }
            if (callback) {
                callback(this.logout_url)
                return true
            }
            return this.logout_url
        },
        
        refreshCredentials: function(settings){
            var request;
            if (settings.auth && settings.auth.provider) {
                request = settings.auth.provider.generatejQueryAuthRequest(settings)
            }else{
                request = AuthProvider.generatejQueryAuthRequest(settings)
            }
            var id = settings.id || this.get_id(request, settings)
            //if (client.endpoint == null) {
            //    _log(settings.log, 'error', ['refreshing credentials needs the endpoint to be set']);
            //    throw Error("Refreshing Credentials needs the endpoint to be set")
            //}
            this.getAuthenticationURL(function(url){
                request.url = url;
                // TODO: this.updateCSRFToken(result)
                var id = this.add_urgent(request, settings, id);
                this.registerCallbacksForRequest(id, {
                    done: function(result){
                        this.syncTimestamp(result.getRequest(), result.getSettings(), result.getResponse())
                    }.bind(this)
                    
                })
                return id
            }.bind(this))
            return id
        },
        
        logout: function(settings){
            //if (client.endpoint == null) {
            //    _log(settings.log, 'error', ['refreshing credentials needs the endpoint to be set']);
            //    throw Error("Refreshing Credentials needs the endpoint to be set")
            //}
            this.getLogoutURL(function(url){
                var request;
                if (settings.auth && settings.auth.provider) {
                    request = settings.auth.provider.generatejQueryLogoutRequest(settings)
                }else{
                    request = AuthProvider.generatejQueryLogoutRequest(settings)
                }
                request.url = url;
                return this.add_urgent(request, settings);
            }.bind(this))
        },
        
        
        blank: function(settings){ // TODO: make this an own BlankApiObject or similar..
            settings['apiClient'] = this;
            settings['isBlank'] = true;
            var obj = new ApiObject(settings);
            return obj.__onGet()
        },
        get: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            return obj.__onGet()
        },
        access: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            return obj.__onGet(true)
        },
        bind: function(){
            this.__bind.apply(this, arguments)
        },
        
        load: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            obj.load(callback);
            return obj.__onLoad()
        },
        
        login: function(settings, callback){
            settings.callback = callback;
            settings.expectsResult = true;
            settings.sendAuth = true;
            return this.refreshCredentials(settings)
        }
        
    
    });
    
    return ApiClient;
});