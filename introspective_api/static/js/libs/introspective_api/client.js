define(['jquery', 'introspective-api-object', "introspective-api-log", 'json', 'hawk'], function ($, ApiObject, _log, JSON2) {
    function ApiClient() {
        this.init.apply(this, arguments);
    };
    
    /* prototype extension */
    $.extend(ApiClient.prototype, {        
        counter:0,
        max_priority:4,
        at_once:5,
        active:0,
        priotirized_requests:{
                0:[],
                1:[],
                2:[],
                3:[],
                4:[]
        },
        queue : {},
        dependencies : {},
        is_active : {},
        deferredQueue: [],
        
        sitemap: null,
        endpoint: null,
        
        additional_headers: [],
        default_headers: [],
        crossDomain: null,
        
        locked: false,
        running: false,
        consumerToken: null,
        csrftoken: null,
        
        clientTimestamp: +new Date()/1000,
        backendTimestamp: +new Date()/1000,        
        
        debug_level: 1,        
         
        accessId: null,
        accessSecret: null,
        accessAlgorithm: null,
        
        _registeredSuccessHandlers:{
            
        },
        _registeredFailHandlers: {
            503:{
                'incomplete': {
                    'obj': null,
                    'callback': function(context){
                        retryAfter = jqXHR.getResponseHeader('Retry-After');
                        return context.methodMap.repeatRequest(retryAfter);
                    }
                },
            },
            401:{
                'auth expired': {
                    'obj': null,
                    'callback': function(context){
                        if (!apiClient.locked) {
                            if (apiClient.debug_level > 0) {
                                _log(context.log, 'debug', ['locked, because not authenticated']);
                            }
                            apiClient.lock();
                            $this.refreshCredentials({
                                callback: context.methodMap.processInteraction,
                                expectsResult: true,
                                forceRefresh: true
                            });
                        }
                        return context.methodMap.deferRequest();
                    }
                },
                'auth missing': {
                    'obj': null,
                    'callback': function(context){
                        if (!apiClient.locked) {
                            if (apiClient.debug_level > 0) {
                                _log(context.log, 'debug', ['locked, because not authenticated']);
                            }
                            apiClient.lock();
                            $this.refreshCredentials({
                                callback: context.methodMap.processInteraction,
                                expectsResult: true,
                                forceRefresh: true
                            });
                        }
                        return context.methodMap.deferRequest();
                    }
                },
                //'consumer missing': function(context){
                //},
            },
        },
        
        getSitemap: function(callback){
            var $this = this;
            if (this.sitemap === null) {
                if (callback == undefined) {
                    throw Error('api endpoint wasnt initialized');
                }
                this.add_urgent({
                    uri: '/',
                    type: 'OPTIONS',
                    ignoreLock: true,
                    isApiInternal: true,
                    done: function(response, status, jqXHR){
                        $this.sitemap = response;
                        callback($this.sitemap.links);
                    }
                })
                return false;
            }
            else{
                if (callback == undefined) {
                        return this.sitemap.links
                    }
                callback(this.sitemap.links);
                return true;    
            }
        },
        
        initialize: function(callback){
            this.getSitemap(function(){
                if (callback){
                    callback();
                }
            })
        },
        
        getCorrectTimestamp: function(){
            return Math.round(+new Date()/1000) - this.clientTimestamp + this.backendTimestamp;
        },
        
        setLanguage: function(languageCode){
            this.default_headers['Accept-Language'] = languageCode;
        },
        
        signRequest: function(request, ajax_settings){
            // Generate Authorization request header
            var auth = ajax_settings.auth;
            var data = {};
            var payload = {};
            //delete settings.data;
            
            var data_values = new Array();
            
            for (key in request.data) {
                data_values.push(key);
            }
            
            if (data_values.length > 0) {
                data_values.sort();
            
                for (key in data_values) {
                    data[data_values[key]] = request.data[data_values[key]]
                }
                
                $.extend(payload, data);
            }else{
                data = null;
            }
            
            request.data = data;
            var options = {
                credentials: auth.auth_callback ? auth.auth_callback() : {
                    id: auth.accessId,
                    key: auth.accessSecret,
                    algorithm: auth.accessAlgorithm
                },
                //ext: 'some-app-data',
                contentType: request.dataType,
                timestamp: this.getCorrectTimestamp(),
            };
            if (data && true) {                    
                options.payload= JSON2.stringify(payload);
            }
            
            var result = hawk.client.header(
                request.url,
                request.type,
                options
                );
            if (result.field && result.artifacts) {
                request.headers.Authorization = result.field;
                auth.artifacts = result.artifacts;
            }else if (options.credentials.id && options.credentials.key && options.credentials.algorithm){
                _log(ajax_settings.log || this__log, 'error', ['error encrypting']);
                throw Error, 'error encrpyting' //todo make global error handler catch this
            }
            
            
            return request;
        },
        
        
        checkResponse: function(xhr, auth, response){
            
            // Check Server Response
            var artifacts = auth.artifacts;
            delete auth.artifacts;
            var credentials= auth.auth_callback ? auth.auth_callback() : {
                    id: auth.accessId,
                    key: auth.accessSecret,
                    algorithm: auth.accessAlgorithm
                };                    
            var options = {
                payload: xhr.responseText ? xhr.responseText : ""
                };
                
            return hawk.client.authenticate(
                xhr, credentials, artifacts, options
                );
            
        },
        
        getProtocol: function(settings){
            return 'http://' // 'https://'
        },
        
        ajax_apiInternal: function( request, ajax_settings){
            var $this = this;
            var ajax = {
                "global": false,
                "headers": {},
                "url": this.endpoint + request.uri,
            };
            delete request.uri;
            
            $.extend(ajax.headers, this.default_headers);
            $.extend(ajax, request);
            $.extend(ajax.headers, this.additional_headers);
            
            if (this.consumerToken ) {
                $.extend(ajax.headers, {
                    "X-ConsumerToken": this.consumerToken                    
                }); 
            }else
            if (this.csrftoken ) {
                $.extend(ajax.headers, {
                    "X-CSRFToken": this.csrftoken                    
                }); 
            }

            
            var url = ajax.url.replace('//', '/');
            
            if (this.crossDomain) {
                ajax.crossDomain = true;
            }
            ajax.url = this.host + ajax.url;
            
            ajax.url = this.getProtocol(ajax_settings) + ajax.url.replace('//', '/');
            
            // signing the request if accessId available
            if (ajax_settings.auth.accessId) {
                ajax_settings.auth._needsAuthentication = true;
                ajax = this.signRequest(ajax, ajax_settings);
            }else if (['post', 'patch', 'put'].indexOf(ajax.type.toLowerCase()) != -1 && (ajax.dataType == 'json' || ajax.data instanceof Object)) {
                ajax.data = JSON.stringify(ajax.data);
                ajax.contentType = 'application/json; charset=utf-8';
                delete ajax.dataType;
            }
        
            
            if (this.debug_level > 0)
                _log(ajax_settings.log || this.__log, 'debug', ['(info)', '[Introspective ApiClient]', 'request:', ajax]);
            var jqxhr = this.ajax(ajax);
            
                jqxhr.done(function(response, status, xhr){
                    ajax_settings.auth._isAuthenticatedResponse = $this.checkResponse(xhr, ajax_settings.auth, response);
                })       
            
            jqxhr.url = url;
            
            return jqxhr;
        },
        
        registerCallbacksForRequest: function(id, callbacks){
            if (this.queue[id] === undefined) {
                _log(this.__log, 'error', ['id "'+id+'" not found in queue']);
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
        },
        
        ajax: function(request){
            return $.ajax(request)
        },
        
        lock: function(){
            this.locked = true;
        },
        
        unlock: function(){
            this.locked = false;
        },
    
    
        init: function(settings){
            var tmp = settings.endpoint.split('://');
            if (tmp.length == 1) {
                tmp = tmp[0];
                this.protocol = null;
            }else{
                tmp = tmp[1];
                this.protocol = tmp[0];
            }
            var tmp2 = tmp.split("/");

            if (tmp2[0] == '') {
                this.host = 'localhost:8001'; // TODO: get current host
            }else {
                this.host = tmp2[0];
                delete tmp2[0];
            }
            this.__log = settings.log;
            _log(this.__log, 'debug', ['(init)', '[Introspective ApiClient]', 'settings:', settings, 'host:', this.host]);
            this.endpoint = tmp2.join('/');
            this.crossDomain = settings.crossDomain;
            
            
            cookie  = this.getCookie('consumerToken');
            if (!this.crossDomain || cookie === undefined){
                cookie  = this.getCookie('csrftoken');
                if (cookie == undefined){
                    alert("NO COOKIES FOUND");// $this.expnCore.popup('no_cookies_found')
                    this.lock();
                }else{
                    this.csrftoken = cookie;
                }
                
            }else{
                this.consumerToken = cookie;
            }
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
    
        /*
         * specify an $.ajax(request), an id of this request for the queue and settings about what to do on adding an request with same id e.g.
         * settings:
         *      dependency: helps to not execute requests, after a third object had been abortet or updated
         *      priority:   from 0-max_priority
         */
        add: function (request, settings, id){
            this.counter+=1;
            if (id==undefined){
                id= request.id || "counted_"+this.counter
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
            if (request.isApiInternal != undefined) {
                settings.isApiInternal = request.isApiInternal
                delete request.isApiInternal;
                
                if (settings.isApiInternal) {
                    settings.auth = settings.auth || request.auth || {};
                    delete request.auth;
                    
                    settings.auth.accessId = settings.auth.accessId || this.accessId;
                    settings.auth.accessSecret = settings.auth.accessSecret || this.accessSecret;
                    settings.auth.accessAlgorithm = this.accessAlgorithm;
                }
            }
            
            if (request.fail != undefined) {
                settings.fail = request.fail
                delete request.fail
            }
            
            if (this.dependencies[id]){
                this.handleDependencies(id)
            }
            if (priority==undefined)
                priority=this.max_priority

            if (this.queue[id]!=undefined){
                if (this.queue[id].priority<priority)
                    delete this.priotirized_requests[priority][$.inArray(id,this.priotirized_requests[priority])]
            }
            this.queue[id]={
                'settings':settings,
                'request':request,
                'callbacks': {},
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
            if (this.active<this.at_once && priority == 0 && (
                                            this.locked == false
                                        ||  settings.ignoreLock
                                        )) {
                this.start(id);
            }else{
                if (!this.priotirized_requests[priority]){
                    _log(settings.log || this.__log, 'error', [priority, 'is not a valid priority']);
                    throw new Error(str(priority) + 'is not a valid priority')
                }
                this.priotirized_requests[priority].push(id)
                
                if (this.active<this.at_once){
                    var $this = this;
                    setTimeout(function (){$this.next()}, 10);
                }
            }
            
            return id;
           },
    
        /*
         * start next highest request
         */
        next:function (){
            for (var i=0;i<=this.max_priority;i++){
                while (this.active<=this.at_once && this.priotirized_requests[i].length>0){
                    cur = this.priotirized_requests[i][this.priotirized_requests[i].length-1]
                    if (this.locked == false || this.queue[cur].settings.ignoreLock) {
                        this.start(this.priotirized_requests[i].pop())
                    }
                }
                if (this.priotirized_requests[i].length>0)
                    break;
            }   
            
        },
    
        /*
         * aborts dependend requests on e.g. abortion of the related request
         */
        handleDependencies: function (id){
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
    
                    //if (this.dependencies[id])
                    //    this.handleDependencies(id)
    
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
    
            var request =   this.queue[id]["request"],
                settings =  this.queue[id]["settings"];
            var $ajax;
            
            if (settings.isApiInternal === true) {
                $ajax = this.ajax_apiInternal(request, settings)
            }else{
                $ajax = this.ajax(request);
            }
            
            this.queue[id]["jqXHR"]=$ajax;
            
            $ajax.then(
                this._get_done_handler(id),
                this._get_fail_handler(id)
            )
            
            return $ajax
        },
        
        get_queue:function(){
            return this.queue
        },
    
        /*
         * function that is a wrapper to do some organizational stuff for queued_ajax and afterwards the complete function of the ajax request
         */
        _complete: function(id){
            var $this=this;
                $this.active-=1;
    
                delete $this.queue[id]
    
                $this.next()    
        },
        
        translateResponse_toJSON: function(jqXHR){
            try {
                return jqXHR.responseText ? JSON.parse(jqXHR.responseText) : {};
            } catch(e) {
                responseHTML = jqXHR.responseText ? $(jqXHR.responseText) : null;
                responseJSON = {};
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
                var method = apiClient.queue[id].settings.fail;
                if (method != undefined){
                    method(jqXHR, statusText, error)
                }
                for (var entry in apiClient.queue[id].callbacks.fail) {
                    apiClient.queue[id].callbacks.fail[entry](jqXHR, statusText, error)
                }
                for (var entry in apiClient.queue[id].callbacks.always) {
                    apiClient.queue[id].callbacks.always[entry](jqXHR, statusText, error)
                }
                for (var entry in apiClient.queue[id].callbacks.then) {
                    apiClient.queue[id].callbacks.then[entry](jqXHR, statusText, error)
                }
                method = apiClient.queue[id].settings.always;
                if (method != undefined){
                    method(error, statusText, jqXHR)
                }
                return apiClient._complete(id);
            }            
        },
        
        _getSuccessCallbackHandler: function(id) {
            var apiClient = this;
            return function (response, statusText, jqXHR){
                if (apiClient.queue[id].settings.auth._needsAuthentication != true ||
                    apiClient.queue[id].settings.auth._isAuthenticatedResponse) {
                    
                    var method = apiClient.queue[id].settings.done;
                    if (method != undefined){
                        method(response, statusText, jqXHR)
                    }   
                    for (var entry in apiClient.queue[id].callbacks.done) {
                        apiClient.queue[id].callbacks.done[entry](response, statusText, jqXHR)
                    }
                    for (var entry in apiClient.queue[id].callbacks.always) {
                        apiClient.queue[id].callbacks.always[entry](response, statusText, jqXHR)
                    }
                    for (var entry in apiClient.queue[id].callbacks.then) {
                        apiClient.queue[id].callbacks.then[entry](response, statusText, jqXHR)
                    }   
                    method = apiClient.queue[id].settings.always;
                    if (method != undefined){
                        method(response, statusText, jqXHR)
                    }
                    return apiClient._complete(id);
                    
                }else{                
                    
                    return methodMap.proceedFailure(jqXHR, "Response not valid", 0);
                    
                }            

            }
        },
        
        registerExternalFailHandlers: function(obj, handlerMap){
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
            $.extend(this._registeredFailHandlers, newHandlers);
        },
        
        registerExternalSuccessHandlers: function(obj, handlerMap){
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
            $.extend(this._registeredSuccessHandlers, newHandlers);
        },
        
        _get_done_handler: function(id){
            var apiClient = this;
            var methodMap = {                
                proceedFailure: apiClient._getFailedCallbackHandler(id),
                proceedSuccess: apiClient._getSuccessCallbackHandler(id),
            };
            
            return function(response, textStatus, jqXHR){
                var status = jqXHR.status;
                
                var context ={
                    response: response,
                    jqXHR: jqXHR,
                    
                    apiClient: apiClient,
                    methodMap: methodMap,
                }
                
                if (apiClient._registeredSuccessHandlers[status] != undefined) {
                    
                    if (apiClient._registeredSuccessHandlers[status][error] != undefined){
                        context.this = apiClient._registeredSuccessHandlers[status][error]['obj']
                        return apiClient._registeredSuccessHandlers[status][error]['callback'](context);
                    
                    }else if (apiClient._registeredSuccessHandlers[status]['.'] != undefined) {
                        context.this = apiClient._registeredSuccessHandlers[status]['.']['obj']
                        return apiClient._registeredSuccessHandlers[status]['.']['callback'](context);
                    
                    }
                }
                
                return methodMap.proceedSuccess(response, textStatus, jqXHR);
            }
        
        },
        
        _get_fail_handler: function(id){
            var apiClient = this;
            
            var methodMap = {
                
                proceedFailure: this._getFailedCallbackHandler(id),
                    
                processInteraction: function (result){
                    if (result === true) {
                        apiClient.unlock();
                        apiClient.handleDeferredRequests();
                    }else{
                        proceedFailure();
                    }
                },
                
                repeatRequest: function (retryAfter) {
                    setTimeout(apiClient.start, parseInt(retryAfter)*1000, id);
                },
                
                deferRequest: function(){
                    apiClient.deferredQueue.push(id);
                }
                
            };
            
            return function(jqXHR, textStatus, error){
                var status = jqXHR.status;
                
                var context ={
                    response: apiClient.translateResponse_toJSON(jqXHR),
                    jqXHR: jqXHR,
                    
                    apiClient: apiClient,
                    methodMap: methodMap,
                }
                
                if (apiClient._registeredFailHandlers[status] != undefined) {
                    
                    if (apiClient._registeredFailHandlers[status][error] != undefined){
                        context.this = apiClient._registeredFailHandlers[status][error]['obj']
                        return apiClient._registeredFailHandlers[status][error]['callback'](context);
                    
                    }else if (apiClient._registeredFailHandlers[status]['.'] != undefined) {
                        context.this = apiClient._registeredFailHandlers[status]['.']['obj']
                        return apiClient._registeredFailHandlers[status]['.']['callback'](context);
                    
                    }
                }
                
                return methodMap.proceedFailure(jqXHR, textStatus, error);
            }
        },
        
        handleDeferredRequests: function(){
            while (this.deferredQueue.length>0){
                this.start(this.deferredQueue.pop())
            }
        },
        
        
        setCredentials: function(response) {                
                this.accessId = response.accessId;
                this.accessSecret = response.accessSecret;
                this.accessAlgorithm = response.accessAlgorithm;
                
        },
        
        refreshCredentials: function(settings){
            var $this = this,
                type = 'get';
            if (! settings) {
                settings = {};
            }
            var $this = this;
            if (this.endpoint == null) {
                _log(settings.log, 'error', ['refreshing credentials needs the endpoint to be set']);
                throw Error("Refreshing Credentials needs the endpoint to be set")
            }
            
            if (settings.sendAuth) {
                authData.username = settings.username;
                authData.password = settings.password;
            }
            
            if (settings.forceRefresh || settings.sendAuth) {
                type = 'post';
            }
            
            this.add_urgent({
                uri: '/auth/credentials/',
                type: type,
                data: authData,
                /*
                 * the CSRF header comes from the 'host domain' of this website. it is the consumer key
                 * (and its validation date),
                 * signed by the consumer secret. now the introspective api host can check, if this is a request
                 * for this identified consumer
                 *
                 */
                
                ignoreLock: true,
                isApiInternal: true,
                done: function(response, status, xhr){
                    $this.setCredentials(response);
                    if (settings.callback){
                        if (settings.expectsResult) {
                            settings.callback({auth: true});
                        }else{
                            if (settings.applyThis) {
                                settings.callback.apply($this)
                            }else{
                                settings.callback();
                            }
                        }
                    }
                },
                fail: function(xhr, status, error){
                    if (settings && settings.callback){
                        if (settings.expectsResult) {
                            settings.callback({auth: false});
                        }else{
                            // if callback doesnt handle result, it shouldn't be called on fail
                        }
                    }
                },
            })
        },
        
        
        get: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            return obj.__onGet()
        },
        access: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            return obj.__onGet(true)
        },
        
        load: function(target, callback){            
            var obj = new ApiObject({apiClient:this, target:target});
            obj.load(callback);
            return obj.__onLoad()
        },
        
        login: function(username, password, callback){
            this.refreshCredentials({
                expectsResult: true,
                sendAuth: true,
                username: username,
                password: password,
                callback: callback
            })
        }
        
    
    });
    
    return ApiClient;
});