
define(["jquery", "introspective-api-client", "introspective-api-log"], function($, IntrospectiveApiClient, _log){
    
    function HostProxy(args) {
        this.init.apply(this, arguments)
    }
    
    $.extend(HostProxy.prototype, {
        init: function(host){
            this.interactor = null;
            this.update(host);
        },
        
        update: function(new_host){
            this.host = new_host;
            this.name = new_host.name;
        },

        getConnection: function(){
            return this.host.getConnection.apply(this.host, arguments)
        },

        asProxy: function(){
            return this.host.asProxy.apply(this.host, arguments)
        },

        initLanguage: function(){
            return this.host.initLanguage.apply(this.host, arguments)
        },

        isCrossDomain: function(){
            return this.host.isCrossDomain.apply(this.host, arguments)
        },

        login: function(){
            return this.host.login.apply(this.host, arguments)
        },
        
        getLog: function(){
            return this.__log || this.host.getLog.apply(this.host, arguments)
        },

        getAuth: function(){
            return this.__auth || this.host.getAuth.apply(this.host, arguments)
        },

        getAuthStatus: function(){
            return this.host.getAuthStatus.apply(this.host, arguments)
        },

        refreshCredentials: function(){
            return this.host.refreshCredentials.apply(this.host, arguments)
        },

        isCrossDomain: function(){
            return this.host.isCrossDomain.apply(this.host, arguments)
        },
        
        getConsumerToken: function(){
            return this.host.getConsumerToken.apply(this.host, arguments)
        },
        
        getCSRFToken: function(){
            return this.host.getCSRFToken.apply(this.host, arguments)
        },
        
        setCSRFToken: function(){
            return this.host.setCSRFToken.apply(this.host, arguments)
        },

        registerInteractor: function(interactor){
            this.interactor = interactor;
            return this
        },

        getInteractor: function(){
            if (this.interactor){
                return this.interactor;
            }
            return this.host.getInteractor.apply(this.host, arguments)
        },

        interact: function(){
            return this.host.interact.apply(this.host, arguments)
        },
        
        prepareRequest: function(){
            return this.host.prepareRequest.apply(this.host, arguments)
        },
        
        discover: function(){
            return this.host.discover.apply(this.host, arguments)
        },
        
        handle: function(){
            return this.host.handle.apply(this.host, arguments)
        },
        
        provide: function(){
            return this.host.provide.apply(this.host, arguments)
        },
        
        getCache: function(){
            return this.host.getCache.apply(this.host, arguments)
        },
        
        setTimestampOffset: function(){
            return this.host.setTimestampOffset.apply(this.host, arguments)
        },
        
        fixTimestamp: function(){
            return this.host.fixTimestamp.apply(this.host, arguments)
        }
    })
    
    function ApiHost() {
        this.init.apply(this, arguments); 
    }
    
    /* prototype extension */
    $.extend(ApiHost.prototype, {
        
        discovered_endpoints: {},
        
        // jquery
        $: $,
        
        // public ajax request
        ajax: null,
        auth: null,
        
        autocomplete_cache: {},// todo remove
        
        active_language_code: null,
        config: null,
        authEndpointHost: null,
        
        xhrHandlerMap: {},
        
        fixTimestamp: function(ts){
            if (this._ts_offset) {
                return ts + this._ts_offset
            };
            return ts
        },
        
        setTimestampOffset: function(offset){
            this._ts_offset = offset;
        },

        ready: function(){
            return true
        },
        
        asProxy: function(){
            return new HostProxy(this);
        },
        
        getCache: function(){
            return this.config.cache
        },
        
        update: function(new_host){
            throw Error('TODO: ?? update');
            if (this.proxies) {
                this.proxies = false;
                return true
            }else{
                // update on real hosts (non proxies) is not possible
                return false
            }
        },
        
        init: function(settings){
            this.__log = settings.log;
            _log(this.__log, 'debug', ['(init)', '[Introspective ApiHost]', 'settings:', settings]);
            var $this = this;
            this.interactor = null;
            this.interactionHandler = null;
            if (settings){
                if (settings.interactionHandler) {
                    this.registerInteractionHandler(settings.interactionHandler);
                    delete settings.interactionHandler;
                }
            }
            this.config = settings || {};
            this.initLanguage() ;
            this.initEndpoints(settings.initCallback);
            this.endpoint = this.config.endpoint;
            this.name = this.config.name || this.endpoint;
            return this
        },

        registerInteractionHandler: function(interactionHandler){
            this.interactionHandler = interactionHandler;
            return this
        },

        registerInteractor: function(interactor){
            this.interactor = interactor;
            return this
        },

        getInteractor: function(){
            return this.interactor;
        },
        
        initLanguage: function(){
            this.$language_selector = this.$('#dynamicWidgetsSelectLanguage');
            
            if (this.$language_selector.size() == 1){                
                var $this = this;
                this.$language_selector.bind('change.dynamic-core.dynamic-language', function(){
                    var newVal = $this.$language_selector.val();
                    if (newVal) {
                        newVal = newVal.toLowerCase();
                        if ($this.active_language_code != newVal) {
                            $this.active_language_code = newVal;
                            $this.getConnection('ajax').setLanguage($this.active_language_code);
                            $this.refresh()
                        }   
                    }
                })
                this.$language_selector.triggerHandler("change.dynamic-core.dynamic-language");
            }
        },
        
        destroy: function(selector){
            /*
             * Use this method when some widget needs to be closed
             */
            
            var $this = this;
            
            
        },
        
        parseLinkHeader: function(link_header){
            link_header_expr = /<([a-z:/\-0-9\.?&_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-?= ]*)",?)*/g
            links = {}
            while (link = link_header_expr.exec(link_header)){
                name = link[3] ? link[3] : link[2];
                links[name] = link[1];
            }
            return links
        },
        
        get_failed_xhr_form_handler: function ($form, action, $widget){
            return this.get_failed_xhr_targeted_handler($form, 'save-failed.dynamic-form', action, $widget)
        },
        
        get_failed_xhr_handler: function (action, $widget){
            return this.get_failed_xhr_targeted_handler(null, null, action, $widget)
        },
        
        get_failed_ajax_handler: function(){
            return this.get_failed_xhr_handler('', undefined)
        },
        
        get_failed_xhr_targeted_handler: function ($target, custom_event, action, $widget){
            var $this = this;
            function failed_contend(jqXHR, status, error){
                
                // parse error
                var error_data = new Array(null);
                if (jqXHR.getResponseHeader('Content-Type')) {
                    if (jqXHR.getResponseHeader('Content-Type').indexOf('application/json') !== -1) {
                        var error_data = new Array(jqXHR.responseText ? JSON.parse(jqXHR.responseText) : null);
                    }else if (jqXHR.getResponseHeader('Content-Type').indexOf('text/html') !== -1) {
                        var error_data = [dynamic.ajax.translateResponse_toJSON(jqXHR)];
                    } 
                }else{
                    // Server not available
                    var error_data = null;
                }
                
                // stop loading status in widget
                if ($widget != undefined) {
                    $widget.triggerHandler('dynamic-end-loading');
                }
                
                // show error
                
                if ($target) {
                    // nothing
                }else if ($widget) {
                    $target = $widget;
                }else{
                    $target = $this.$root_targets;
                }
                
                if ($target) {
                    $target.trigger('dynamic-errors', [action, error_data, jqXHR]);
                    if (custom_event != null)
                        $target.trigger(custom_event);  
                }
                
                              
            }
            return failed_contend;
        },
        
        get_globalError_handler: function($this){
            return function (event, action, errors, jqXHR){ // none form saving related stuff
                var notification;
                var $target = $(event.target);
                if (errors) {
                    $this.$.each(errors, function(index, elem){
                        if (elem != null){
                            
                            if (elem.html) {
                                notification = '<div class="dynamic-title">'+action+'</div>'+elem.html;
                            }else{
                                notification = '<div class="dynamic-title">'+action+'</div>';
                                notification += '<div class="dynamic-error"><div class="dynamic-msg">'+elem.msg+'</div>';                               
                                notification += '<div class="dynamic-detail">'+elem.detail+'</div>';                            
                                
                                if (jqXHR) {
                                    notification += '<div class="dynamic-response">'+jqXHR.responseText+'</div>';   
                                }
                                
                                notification += '</div>'; 
                                
                            }                            
                        }
                        else{
                            
                            notification = action + ': server nicht erreichbar';
                        }
                    }); 
                }else{
                    
                    notification = action + ': server error';
                }
                $target.triggerHandler('dynamic-notification', ['error', notification])   
                event.stopImmediatePropagation();
                return false;
            };
        },
                
        get_notification_handler: function(){
            return function(event, type, message){
                var $this = $(event.target);
                var $notification = $('<div class="dynamic-notification dynamic-notification-'+type+'"><div class="dynamic-actionbar"></div><div class="dynamic-content">' + message +'</div></div>');
                $this.prepend($notification);
                var left = $this.innerWidth()/2 - ($notification.outerWidth())/2;
                $notification.css("margin-left", left);
                if (type == "success") {
                    setTimeout(function(){$notification.remove()}, 3500);
                }else{
                    $notification.find('.dynamic-actionbar').append(' <span class="dynamic-icon-close"></span> ');
                    $notification.find('.dynamic-icon-close').on('click', function(){
                        $notification.remove();
                    })
                }
                
            }
        },
        
        get_globalWarning_handler: function($this){
            return this.get_globalError_handler($this)
        },
        
        resolve_endpoint: function (endpoint){
            if (discovered_endpoints[endpoint] == undefined){
                this.discover_endpoint(endpoint)
            }
            
            return discovered_endpoints[endpoint].url
            /*
                namespace_expr = /([a-zA-Z0-9\-_ ]):/g
                viewname_expr = /(?:[a-zA-Z0-9\-_ ]*:)*([a-zA-Z0-9\-_ ])/g
                namespaces = {}
                cur_position = this.discovered_urls
                while (namespace = namespace_expr.exec(view_name)){
                    if (! cur_position[namespace[0]]){
                        // right now there is no knowledge of this namespace
                        // discover it
                        self.discover(cur_position,namespace[1])
                    }
                }
                return ""
                this.links = links*/
        },
        interact: function(config){
            return this.interactionHandler(this, config);
        },

        get_root: function(){
            return this.config.endpoint
        },

        isCrossDomain: function(){
            if (this.config.endpoint[0] == '/') {
                return false
            }
            // TODO: is this really the best way? security?
            return this.config.endpoint.indexOf('://' + window.location.host + (window.location.port ? ':' + window.location.port: '')) == -1
        },
        
        getConsumerToken: function(){
            return this.config.consumerToken
        },
        
        getCSRFToken: function(){
            return this.config.csrfToken
        },
        
        setCSRFToken: function(token){
            this.config.csrfToken = token
        },
        
        getAuth: function(){
            return this.config.auth
        },
        
        getLog: function(){
            return this.config.log
        },
        
        prepareRequest: function(type, request, settings){
            if (type == 'jQuery') {
                var endpoint = this.getConnection('ajax').parseEndpoint(this.config.endpoint)
                if (request.uri && request.uri.indexOf('://') != -1) {
                    request.url = request.uri;
                    //delete request.uri
                }
                request.url = typeof(request.uri) == 'string' ? endpoint.endpoint + (request.uri[0] != '/' ? '/' : '') + request.uri : request.url;
                if (request.uri && !this.config.endpoint) {
                    throw Error('not allowed: ' + request.uri)
                }
                //delete request.uri;
                request.url = request.url.replace(/\/\//g, '/').replace(':/', '://')
                
                
                var prefix = '://' + endpoint.host + endpoint.endpoint;
                if (request.url.toLowerCase().indexOf(prefix.toLowerCase()) == -1) {
                    if (request.url.indexOf('://') != -1) {
                        throw Error('not allowed: ' + request.url + ' on host: ' + prefix)
                    }
                    request.url = endpoint.host + request.url;
                }; 
                
                // TODO: check only URL part before QUERY STRING - as :// can be unencoded in there?
                if (request.url.indexOf('://') == -1) {
                    var connection = this.getConnection('ajax').getProtocol(settings);
                    request.url = connection + request.url;
                    request.base_url = connection + endpoint.host +  endpoint.endpoint + '/';
                }else{
                    request.base_url = request.url.split('://')[0] + '://' + endpoint.host +  endpoint.endpoint + '/';
                }

                if ((request.url.indexOf('?') != -1 ? request.url[request.url.indexOf('?')-1] : request.url[request.url.length -1]) != '/') {
                    index = request.url.indexOf('?') != -1 ? request.url.indexOf('?') : (request.url.length)
                    request.url = request.url.substr(0, index) + '/' + (request.url.length > index ? request.url.substr(index) : '');
                }
                if (!settings.auth || $.isEmptyObject(settings.auth)) {
                    settings.auth = this.getAuth();
                }
                
                if (!settings.log) {
                    settings.log = this.getLog();
                }
                
                if (!request.type) {
                    request.type = 'get';
                }
                
                if (!settings.source && this.getInteractor()) {
                    settings.source = this.getInteractor();
                }
                settings.isApiInternal = true;
            }
        },
        
        discover: function(url, namespace){
            console.error('not implemented yet', new Error().stack)
        },
            
        parse_link_header: function(link_header){
            link_header_expr = /<([a-z:/\-0-9\.?_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-?= ]*)",?)*/g
            links = {}
            while (link = link_header_expr.exec(link_header)){
                name = link[3] ? link[3] : link[2];
                links[name] = link[1]
            }
            this.links = links
        },
        
        
        initEndpoints: function(){
            
            settings = this.config;
            
            this.ajax = new IntrospectiveApiClient({
                cache: this.getCache(),
                endpoint:   settings.endpoint,
                crossDomain: settings.crossDomain,
                log: this.getLog()
            });
            
            this.ajax.registerExternalHandlers(this, this.xhrHandlerMap);
            this.ajax.initialize(settings.callback);
            
        },
        
        setCredentials: function(accessId, accessSecret, accessAlgorithm) {
            _log(this.__log, 'error', ['not implemented']);
            throw Error("not implemented")
                
        },
        
        refreshCredentials: function(callback_or_settings){
            var settings = {};
            if (typeof callback_or_settings === 'object') {
                settings = callback_or_settings;
            }else{
                settings.callback = callback_or_settings ? function(result){
                    callback_or_settings(result)
                } : undefined;
                settings.expectsResult = false;  // TODO: returns false not immediately, but after user was logged in
            }
            return this.getConnection('ajax').refreshCredentials(settings)
        },
        
        getAuthStatus: function(callback){
            return this.getConnection('ajax').refreshCredentials({
                expectsResult: true,
                callback: callback ? function(result){
                    callback(result)
                } : undefined
            })
        },
        
        login: function(settings, callback){
            if (settings.callback) {
                callback = settings.callback;
                delete settings.callback;
            }
            if (settings.method === 'credentials') {
                return this.getConnection('ajax').login(settings, function(result){
                    if (result.isAuthenticated() === true) {
                        //this.getConnection('ajax').profileId = result.profile;
                        //this.auth.proxies(result)
                        return callback(result)
                    }else{
                        //this.getConnection('ajax').profileId = undefined; 
                        result.reset();
                        return callback(result)
                    }
                });
            }else{
                _log(settings.log || this.__log, 'error', ['not known login method']);
                throw Error('not known login method')
            }
        },
        
        logout: function(settings, callback){
            settings.callback = callback;
            settings.type = 'post';
            return this.getConnection('ajax').logout(settings);
        },
        
        handle: function(request, config){
            _log((config && config.log ? config.log : request.log) || this.getLog(), 'debug', ['[IntrospectiveApi]', '[ApiHost]', '(handle)', request, config]);
            return ApiHost.prototype.handle.apply(this, arguments)
            throw Error('TODO: implement ApiHost.handle() for ' + request.__proto__.constructor.name)
            
        },
        
        provide: function(source, config){
            _log((config && config.log ? config.log : source.log) || this.getLog(), 'debug', ['[IntrospectiveApi]', '[ApiHost]', '(provide)', source, config]);
            var cache = this.getCache();
            $.extend(source, {
                        apiClient:this.getConnection('ajax'),
                        host: this
                    })
            this.prepareRequest('jQuery', source, {});
            return cache.provide.apply(cache, arguments)
        },
        
        getConnection: function(){
            return this.ajax
        }
        
    });
    

    function XhrHost() {
        this.init.apply(this, arguments); 
    }
    
    /* prototype extension */
    $.extend(XhrHost.prototype, ApiHost.prototype);
    $.extend(XhrHost.prototype, {
        initEndpoints: function(){
            
            settings = this.config;
            
            //this.  // TODO
            
        },
        
        handle: function(source, config){
            _log((config && config.log ? config.log : source.log) || this.getLog(), 'debug', ['[IntrospectiveApi]', '[XhrHost]', '(handle)', source, config]);
            if (typeof(source) == 'object' && (source.url || source.uri)) {
                if (source.url && source[0] != '/') {
                    source.uri = source.url
                    delete source.url
                }
                if (config && config.complement) {
                    $.each(config.complement, function(key, value){
                        source[key] = value
                    })
                    delete config.complement
                }
                
                return this.getConnection('ajax').add(source, config)
            }
            //if (source.asXHR) {
            //    return this.handle(source.asXHR(), config)
            //}
            return ApiHost.prototype.handle.apply(this, arguments)
            
        },
        
        discover: function(request, config){
            config = config || {};
            config.complement = config.complement || {};
            config.complement.type = 'options';
            request.raw = true;
            
            return this.handle.call(this, request, config)
            
        },
        
        
    }); 
    

    function IntrospectiveApiHost() {
        this.init.apply(this, arguments); 
    }
    
    /* prototype extension */
    $.extend(IntrospectiveApiHost.prototype, XhrHost.prototype);
    $.extend(IntrospectiveApiHost.prototype, {
        xhrHandlerMap: {
                503:{
                    'INCOMPLETE': {
                        'obj': null,
                        'callback': function(context){
                            retryAfter = jqXHR.getResponseHeader('Retry-After');
                            return context.methodMap.repeatRequest(retryAfter);
                        }
                    },
                    'MAINTENANCE':function(context){
                        context.apiClient.lock()
                        context.this.interact({
                            context: context,
                            interaction: context.code,
                            data: context.response,
                            callback: context.methodMap.processInteraction,
                            source: context.source
                        })   
                        context.this.widgetCore.showMaintenance(responseJSON);
                    }
                },
                403:{
                    'TOS ACCEPTANCE MISSING':function(context){
                                        if (!context.apiClient.locked_restricted) {
                                                context.apiClient.lock('restricted');   
                                            }
                                            context.this.interact({
                                                context: context,
                                                interaction: context.code,
                                                data: context.response,
                                                callback: context.methodMap.processInteraction/*function (result){
                                                    //context.apiClient.refreshCredentials({
                                                    //    callback: context.methodMap.processInteraction,
                                                    //    expectsResult: true,
                                                    //    forceRefresh: false
                                                    //});
                                                    context.methodMap.processInteraction(result)
                                                }*/,
                                                source: context.source
                                            })
                                            return context.methodMap.deferRequest();
                    }
                },
                401:{
                    'AUTHENTICATION MISSING':function(context){
                                        if (!context.apiClient.locked_authenticated) {
                                                context.apiClient.lock('authenticated');   
                                            }
                                            context.this.interact({
                                                context: context,
                                                interaction: context.code,
                                                data: context.response,
                                                callback: context.methodMap.processInteraction/*function (result){
                                                    //context.apiClient.refreshCredentials({
                                                    //    callback: context.methodMap.processInteraction,
                                                    //    expectsResult: true,
                                                    //    forceRefresh: false
                                                    //});
                                                    context.methodMap.processInteraction(result)
                                                }*/,
                                                source: context.source
                                            })
                                            return context.methodMap.deferRequest();
                    },
                    'UNAUTHORIZED': function(context){
                        return context.methodMap.proceedFailure()
                    }
                }
            },
        initEndpoints: function(){
            
            settings = this.config;
            
            this.ajax = new IntrospectiveApiClient({
                endpoint:   settings.endpoint,
                crossDomain: settings.crossDomain,
                host: this,
                cache: settings.cache,
                log: this.getLog()
            });
            
            this.ajax.registerExternalHandlers(this, this.xhrHandlerMap);
            this.ajax.initialize(settings.callback);
            
        },
        
    }); 
    
    return {
        ApiHost: ApiHost,
        IntrospectiveApiHost: IntrospectiveApiHost,
        XhrHost: XhrHost,
        Proxy: HostProxy
    }
});