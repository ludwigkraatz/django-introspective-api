
define(["jquery", "introspective-api-client", "introspective-api-log"], function($, IntrospectiveApiClient, _log){
    function ApiEndpoint() {
        this.init.apply(this, arguments); 
    }
    
    /* prototype extension */
    $.extend(ApiEndpoint.prototype, {
        
        discovered_endpoints: {},
        
        // jquery
        $: $,
        
        // public ajax request
        ajax: null,
        
        autocomplete_cache: {},// todo remove
        
        active_language_code: null,
        config: null,
        authEndpointHost: null,
        
        xhrHandlerMap: {},
        
        init: function(settings){
            this.__log = settings.log;
            _log(this.__log, 'debug', ['(init)', '[Introspective ApiEndpoint]', 'settings:', settings]);
            var $this = this;
            
            this.config = settings;
            
            this.initLanguage()            
            this.initEndpoints(this.initCallback);
            
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
                            $this.ajax.setLanguage($this.active_language_code);
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
        
        discover: function(url, namespace){
            
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
                endpoint:   settings.endpoint,
                crossDomain: settings.crossDomain
            });
            
            this.ajax.registerExternalHandlers(this, this.xhrHandlerMap);
            this.ajax.initialize(settings.callback);
            
        },
        
        setCredentials: function(accessId, accessSecret, accessAlgorithm) {
            _log(this.__log, 'error', ['not implemented']);
            throw Error("not implemented")
                
        },
        
        refreshCredentials: function(callback){
            this.ajax.refreshCredentials({
                expectsResult: false, // TODO: returns false not immediately, but after user was logged in
                callback: callback ? function(result){
                    callback(result)
                } : undefined
            })
        },
        
        getAuthStatus: function(callback){
            this.ajax.refreshCredentials({
                expectsResult: true,
                callback: callback ? function(result){
                    callback(result)
                } : undefined
            })
        },
        
        login: function(settings, callback){
            if (settings.auth === 'credentials') {
                return this.ajax.login(settings.username, settings.password, function(result){
                    if (result.auth === true) {
                        return callback({
                            isAuthenticated: true,
                        })
                    }else{                        
                        return callback({
                            isAuthenticated: false,
                        })
                    }
                });
            }else{
                _log(settings.log || this.__log, 'error', ['not known login method']);
                throw Error('not known login method')
            }
        }
        
    }); 
    
    return ApiEndpoint
});