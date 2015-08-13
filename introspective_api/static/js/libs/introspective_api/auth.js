define(['jquery', 'json', "introspective-api-log", 'introspective-api-utils', 'hawk'], function($, JSON2, _log, apiUtils){
    
     // object - keys: profile id. values: access info
    var _auth = {
            profiles: {
                // id: {
                    //info: {},
                    //api_keys: {
                    //      endpoint: key
                    //},
                    //auth_endpoint: 
                    //endpoints: []
                //}
            },
            api_keys: {
                //id {
                    // accessId
                    // algorithm:
                    // secret:
                    // type: [HAWK]
                //}
            },
            
        };
    
    function ApiAuth() {
        this.init.apply(this, arguments)
    }
    
    $.extend(ApiAuth.prototype, apiUtils.EventMixin, {
        auto_logout_time: null,  // in seconds
        
        interactionHandler: null,

        _reset: function(){
            this.proxied = null;
            this.profile = undefined;
            this.auth_requests = {};
            // set it undefined in internal resets, in order to know if its surely not authenticated or just not tried yet
            this._last_authenticated = {};
            this.__initEventMixin({
                'authenticated': {},
                'logged_out': {}
            });
        },
        
        update: function(new_auth){
            if (typeof(new_auth) == 'string') {
                if (this.profile == new_auth) {
                    return null
                }
                if (this === new_auth) {
                    return null
                }
                if (this.proxies === new_auth) {
                    return null
                }
                if (typeof(new_auth) != 'string') {
                    this.proxies = new_auth;
                    return true
                }
                this.profile = new_auth
                if (this.proxied) {
                    throw Error('TODO: auth needs to make sure, that after updating a proxy, it is configured correctly');
                    this.proxied = null;
                }
                return true
            }else{
                // update currently only supports profile_id updates, not update from e.g. other ApiAuths
                return false
            }
        },

        reset: function(host){
            this.logout(host)
            // TODO: dependent on host?
            var ret = this._reset()
            this.profile = null;
            return ret
        },

        init: function(provider, settings){
            this.provider = provider;
            this.config = {};
            this._reset()
            if (settings && settings.constructor === ApiAuth) {
                this.proxies(settings)
            }else if (settings){
                this.setup(settings);
            }
        },

        setup: function(settings){
            if (settings.hosts) {
                this.hosts = settings.hosts;
                delete settings.hosts;
            }
            if (settings.default_host) {
                this.default_host = settings.default_host;
                delete settings.default_host;
            }
            this.config = settings;
            return this
        },
        
        asProxy: function(){
            return new ApiAuth(this.provider, this)
        },
        
        proxies: function(proxied){
            this._reset();
            this.proxied = proxied;
        },
        
        info: function(){
            if (!this.profile) {
                return null
            }
            return _auth.profiles[this.profile].info
        },
        
        getProfile: function(){
            if (this.proxied) {
                return this.proxied.getProfile()
            }
            return this.profile
        },
        
        isAuthenticated: function(host){
            if (this.proxied) {
                return this.proxied.isAuthenticated(host)
            }
            if (!host) {
                host = this.default_host;
            }
            if (this.profile) {  // TODO: when profile === undefined, host.getAuthStatus()
                if (this._last_authenticated[host] !== undefined) {
                    if (this.auto_logout_time && (
                            this.auto_logout_time + this._last_authenticated[host][1] < (+new Date()/1000)
                        )) {
                        return undefined
                    }
                    return true
                }
                return undefined
            }
            
            if (!$.isEmptyObject(this.auth_requests)) {
                return undefined
            }
            return false
        },
        
        authenticate: function(settings, result){
            if (this.proxied) {
                this.proxied.refresh.apply(this.proxied, arguments)
            }else{
                var host = this.resolveHost(undefined, settings, false),
                    response = result.getResponse(),
                    profile = response.profile,
                    csrf_token = response.csrf_token;
                this.provider.addProfile(profile, result.getResponse());
                // TODO: update info
                this._last_authenticated[host] = [settings.method, +new Date()/1000];
                if (csrf_token) {
                    this.hosts[host].setCSRFToken(csrf_token);
                }
                this.update(profile);
                delete this.auth_requests[host];
                
                
                // resetting the old object, to have only one location where the access secret is stored
                result.getResponse()['accessSecret'] = null;
                result.getXhr()['responseText'] = null;
                result.getXhr()['response'] = null;
                this.__trigger('authenticated', profile)
            }
            return this
        },

        getInteractionHandler: function(){
            return this.interactionHandler
        },

        resolveHost: function(host, settings, patch_settings){
            if (!host) {
                if (settings.host) {
                    host = settings.host
                }else{
                    host = this.default_host;
                }
            }
            if (settings && patch_settings !== false) {
                this._patchHostSettings(host, settings)
            }
            return host.name ? host.name : host
        },

        refresh: function(host){
            if (this.proxied) {
                return this.proxied.refresh.apply(this.proxied, arguments)
            }else{
                var settings = {},
                    result = {};
                if (typeof(host) == 'object') {
                    settings = host;
                    host = settings.host;
                    delete settings.host;
                }
                host = this.resolveHost(host, settings)
                settings.auth = this;
                if (this.auth_requests[host]) {
                    result.request_id = this.auth_requests[host];
                }else{
                    settings.callback = function(host, superCallback, result){
                        delete this.auth_requests[host];
                        if (superCallback)superCallback(result);
                    }.bind(this, host, settings.callback);
                    
                    if (this.isAuthenticated(host) !== false) {
                        // get accessStuff
                        result.request_id = this.hosts[host].refreshCredentials(settings)
                    }else{
                        result.request_id = this.hosts[host].refreshCredentials(settings)
                    }
                    this.auth_requests[host] = result.request_id;
                }

                    
            }
            return result
        },

        _patchHostSettings: function(host, settings){
            // TODO: depending from host
            settings.auth = this;
        },

        logout: function(host, settings, callback){
            if (!settings) {
                settings = {};
            }
            if (this.proxied) {
                this.proxied.logout.apply(this.proxied, arguments)
            }else{
                if (typeof(host) == 'object' && settings === undefined) {
                    settings = host;
                    host = settings.host;
                }
            
                settings.auth = this;
                host = this.resolveHost(host, settings);
                this.hosts[host].logout(settings, function(result){
                    // TODO: delete accessKeys a.s.o.
                    if (callback)callback(result);
                    this.__trigger('logged_out')
                }.bind(this));
            }
            return this
        },
        
        login: function(host, settings, callback){
            if (this.proxied) {
                this.proxied.login.apply(this.proxied, arguments)
            }else{
                if (typeof(host) == 'object' && settings === undefined) {
                    settings = host;
                    host = settings.host;
                }
            
                settings.auth = this;
                host = this.resolveHost(host, settings);
                // TODO: patch host to settings.data.username
                this.hosts[host].login(settings, function(result){
                    // TODO: take settings.data.username for info
                    // TODO: delete settings.data.* as this is sensitive data
                    //delete result.getRequest().data;
                    if (callback)callback(result);
                });
                
            }
            return this
        },
        
        sign: function(what, config){
            if (what == 'jQuery') {
                return this.provider.sign_jQueryRequest(config.request, config.settings)
            }
            throw Error('TODO: implement Auth.sign()')
        },
        
        validate: function(what, config){
            if (what == 'jQuery') {
                return this.provider.validate_jQueryXHR(config.xhr, config.settings)
            }
            throw Error('TODO: implement Auth.validate()')
        },
        
        ensureValid: function(){
            valid = this.validate.apply(this, arguments);
            if (!valid) {
                throw Error('not vaid')
            }
            return true
        }

    });
        
        
    function ApiAuthProvider() {
        this.init.apply(this, arguments); 
    };
    
    /* prototype extension */
    $.extend(ApiAuthProvider.prototype, {
        
        clientTimestamp: null,  // +new Date()/1000
        backendTimestamp: null,

        init: function(){
            
        },

        newAuth: function(config){
            return new ApiAuth(this, config)
        },
        
        addProfile: function(profile_id, access_info, clearance){
            _auth.profiles[profile_id] = {
                info: {identifier: profile_id},
                api_keys: [access_info.accessId]
            }
            _auth.api_keys[access_info.accessId] = $.extend({}, access_info);
        },
        
        addEndpoint: function(){
            
        },
        
        getCorrectTimestamp: function(){
            if (this.backendTimestamp) {
                return Math.round(+new Date()/1000) - this.clientTimestamp + this.backendTimestamp;
            }
            return Math.round(+new Date()/1000);
        },
        
        getAccessInfo: function(action){
            if (action.settings.auth.accessId) {
                if (action.settings.auth.accessSecret && action.settings.auth.accessAlgorithm) {
                    _log(action.settings.log, '(debug)', ['(IntrospectiveApi)', '(auth)', 'getting Access Info from settings'])
                    return action.settings.auth
                }
                _log(action.settings.log, '(debug)', ['(IntrospectiveApi)', '(auth)', 'getting Access Info from accessId'])
                return $.extend({}, _auth.api_keys[action.settings.auth.accessId])
            }
            if (action.settings.auth.profile) {
                _log(action.settings.log, '(debug)', ['(IntrospectiveApi)', '(auth)', 'getting Access Info from profileId'])
                return $.extend({}, _auth.api_keys[_auth.profiles[action.settings.auth.profile].api_keys[0]])
            }
            if (action.settings.auth instanceof ApiAuth) {
                _log(action.settings.log, '(debug)', ['(IntrospectiveApi)', '(auth)', 'getting Access Info from apiAuth'])
                return $.extend({}, _auth.api_keys[_auth.profiles[action.settings.auth.getProfile()].api_keys[0]])
            }
            return null
            if (action.request) {
                return action.settings.auth
            }
            return action.settings.auth
        },
        
        sign_jQueryRequest: function(request, settings){
            // Generate Authorization request header
            var auth = this.getAccessInfo({
                request: request,
                settings: settings
            });
            var data;
            //delete settings.data;
            _log(settings.log || this.__log, 'debug', ['(IntrospectiveApi)', '(ApiAuth)', '(resquest)', 'signing', request, 'with', settings])
            if (settings.signPayload !== false) {
                var payload = {};
                data = {};
                
            
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
            }else{
                data = null;
            }
            
            
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
            if (data) {                    
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
                _log(settings.log || this.__log, 'error', ['error encrypting']);
                throw Error, 'error encrpyting' //todo make global error handler catch this
            }
            
            return request;
        },
        
        
        validate_jQueryXHR: function(xhr, settings){            
            // Check Server Response
            var log = settings.log;
            var auth = this.getAccessInfo({
                xhr: xhr,
                settings: settings
            });
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
            
            if (this.debug_level > 0){
                // TODO: don't log accessSecret
                _log(log || this.__log, 'debug', ['(IntrospectiveApi)', '(ApiAuth)', '(response)', 'authenticating XHR:', xhr, 'with settings:', settings, 'options:', options])
            }
            return hawk.client.authenticate(
                xhr, credentials, artifacts, options
                );
            
        },

        generatejQueryAuthRequest: function(settings){
            var $this = this,
                type = 'post',
                authData = {};
            if (! settings) {
                settings = {};
            }
            var $this = this;
            if (!settings.auth) {
                throw Error('"auth" setting needed for authentication')
            }

            if (settings.sendAuth) {
                authData.username = settings.username;
                authData.password = settings.password;
            }
            if (settings.password) {
                delete settings.password
            }
            _log(settings.log, 'debug', ['[IntrospectiveApi]', '[auth]', 'generating auth request', settings])
            
            if (settings.forceRefresh || settings.sendAuth) {
                type = 'post';
            }
            var $this = this;
            return {
                //uri: '/auth/login/',
                type: type,
                data: authData,
                /*
                 * the CSRF header comes from the 'host domain' of this website. it is the consumer key
                 * (and its validation date),
                 * signed by the consumer secret. now the introspective api host can check, if this is a request
                 * for this identified consumer
                 *
                 */
                auth: settings.auth,
                source: settings.source,
                cache: false,
                
                ignoreLock: true,
                isApiInternal: true,
                done: function(result){
                    var auth;
                    if (settings.auth && typeof(settings.auth.authenticate) == 'function') {
                        auth = settings.auth.authenticate(settings, result)
                    }else{
                        throw Error('TODO: implement AuthProvider.authRequest -> done -> no settings.auth')
                        auth = response;//client.setCredentials(response)
                    }
                    
                    if (settings.callback) {
                        settings.callback(auth, arguments)
                    }
                },
                fail: function(){
                    if (settings.callback) {
                        settings.callback(settings.auth, arguments)
                    }
                }
            //request['done'] = this.successfullLoginHandler(client, settings);
            //request['fail'] = this.failedLoginHandler(client, settings);
            }
        },

        generatejQueryLogoutRequest: function(settings){
            var $this = this,
                type = 'post',
                authData = {};
            if (! settings) {
                settings = {};
            }
            var $this = this;
            if (!settings.auth) {
                throw Error('"auth" setting needed for authentication')
            }
            _log(settings.log, 'debug', ['[IntrospectiveApi]', '[auth]', 'generating logout request', settings])
            
            var $this = this;
            return {
                //uri: is set by the client
                type: type,
                data: authData,
                auth: settings.auth,
                source: settings.source,
                cache: false,
                
                ignoreLock: true,
                isApiInternal: true,
                done: function(result){
                    if (settings.source) {
                        settings.source.refresh();
                    }
                    
                    if (settings.callback) {
                        settings.callback(settings.auth, arguments)
                    }
                },
                fail: function(){
                    if (settings.callback) {
                        settings.callback(settings.auth, arguments)
                    }
                }
            //request['done'] = this.successfullLoginHandler(client, settings);
            //request['fail'] = this.failedLoginHandler(client, settings);
            }
        },
        //
        //successfullLoginHandler: function(client, settings){
        //    var $this = this;
        //    return function(response, status, xhr){
        //            var auth = undefined;
        //
        //            client.setCredentials(response);
        //            if (settings.callback){
        //                if (settings.expectsResult) {
        //                    settings.callback(auth);
        //                }else{
        //                    if (settings.applyThis) {
        //                        settings.callback.apply(client)
        //                    }else{
        //                        settings.callback(auth);
        //                    }
        //                }
        //            }
        //        }
        //},
        //
        //failedLoginHandler: function(client, settings){
        //    var $this=this;
        //    return function(xhr, status, error){
        //            if (settings && settings.callback){
        //                if (settings.expectsResult) {
        //                    settings.callback({auth: false});
        //                }else{
        //                    // if callback doesnt handle result, it shouldn't be called on fail
        //                }
        //            }
        //        }
        //}
    });

    return new ApiAuthProvider()
});