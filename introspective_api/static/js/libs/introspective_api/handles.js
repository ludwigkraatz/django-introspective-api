define(['jquery', "introspective-api-resources", 'introspective-api-log', 'json'], function ($, apiResources, _log, JSON) {
    var handles;
    /* an api window is a specified frontend-handle for api data, which
     * extracts data from ApiObjects or Resources as specified.
    */
    
    
    function ApiHandle() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiHandle.prototype, {
        api_object_class: null,
        __init: function(config, state, init){
            this.init = init || {};
            this.config = config || {};
            if (state) {
                this.config.state = state;
            }
            
            this.handler = null;
        },
        
        getState: function(){
            var state = {}
            if (this.config.state) {
                $.extend(state, this.config.state);  // we dont want to polute the source of the state, so copy it
            }
            if (this.config.state_defaults) {
                $.each(this.config.state_defaults, function(name, value){
                    state[name] = state.hasOwnProperty(name) ? state[name] : value;
                }.bind(this))
            }
            return state;
        },
        
        generateStateLookup: function(){
            var state_lookup = {},
                state = this.getState();
            if (state) {
                if (state.asPrimary) {
                    state_lookup['primary'] = true;
                }
                if (state.filter == 'me') {
                    state_lookup['private'] = true;
                }
                if (state.filter == 'my') {
                    state_lookup['private'] = true;
                }
            }
            return state_lookup;
        },
        
        getContent: function(){
            var resource = this.resource;
            if (!resource) {
                return undefined
            }if (resource.__proto__ && resource.__proto__.constructor === Object){
                return resource
            }
            return this.getResource().getContent('json')
        },
        
        getBaseHandle: function(){
            if (this.config.handle) {
                return this.config.handle
            }
            return this
        },
        
        applyState: function(request, state_query_args){
            var base_handle = this.getBaseHandle();
            if (base_handle && base_handle !== this) {
                base_handle.applyState.apply(base_handle, arguments);
            }
            state_query_args = state_query_args || this.generateStateLookup();
            if (request.url) {
                request.url = this.addQueryToUrl(request.url, state_query_args)
            }
            if (request.uri) {
                request.uri = this.addQueryToUrl(request.uri, state_query_args)
            }
            if (!request.log) {
                request.log = this.getLog();
            }
            if (!request.auth) {
                request.auth = this.getAuth();
            }
            if (!request.source) {
                request.source = this.config.source;
            }
            return request
        },
        
        
        addQueryToUrl: function(url, query_dict) {  // TODO: urlencode?
            $.each(query_dict, function(key, value){
                url += (url.indexOf('?') != -1 ? '&' : '?') + key + '=' + value
            })
            return url
        },
        
        getHost: function(){
            return this.config.host
        },
        
        getAuth: function(){
            return this.config.auth
        },
        
        getLog: function(){
            return this.config.log
        },
        
        update: function(key, value){
            if (this.config[key] == value) {
                return false
            }
            this.config[key] = value;
            if (!this.handler) {
                return true
            }
            return this.handler.update(key, value)
        },
        
        getHandle: function(){
            return this
        },

        asClone: function(config, handle){
            if (!handle) {
                handle = this.getHandle();
            }
            var ret = new this.__proto__.constructor($.extend(handle.getInit(), config));
            //ret.source = this.source;
            ret.handler = this.handler;
            ret.handle(this.source)  // TODO: calling handle with  handler, that doesnt handle -> results in endless recursive loop
            return ret
        },
        
        discover: function(settings){
            this.asRequest(settings);
            return this.getHost().discover(settings);
        },
        
        asRequest: function(source){
            if (!source) {
                source = this.source;
            }
            var settings = {};
            if (typeof(source) == 'string') {
                settings['uri'] = source
            }else if (typeof(source) == 'object' && (source.uri || source.url)) {
                $.extend(settings, source);
            }else if (typeof(source) == 'object') {
                throw Error('not implemented yet: asRequest with source == object')
            }
            return this.applyState(settings)
        },
        
        handle: function(source, handler, callback){
            _log(this.getLog(), 'debug', ['[IntrospectiveApi]', '[ApiHandle]', '(handle)', source, handler]);
            this._current_args = arguments
            var config = typeof(handler) == 'object' ? handler : undefined;
            handler = config === undefined ? handler : config.handler;
            
            // ApiObject: prepare specific Resource or simply object
            // ApiView: prepare Resources/Objects
            // url: fetch url and prepare result
            handler = handler || this.config.handler;
            
            if (source == this.handler) {
                return this.asClone(config);
            }
            
            var chosen_handler, returned;
            if ((handler && source instanceof handler) || (handler === undefined && source && typeof(source.handle) == 'function')) {
                // TODO: update init? no..
                chosen_handler = source
            }else{
                returned = this.parseSourceHandler(source, handler, this.executeHandler.bind(this, callback));
            
                if (returned) {
                    // callback is not needed when executed in time
                    chosen_handler = this.executeHandler(undefined, returned);
                }
            }
            
            if (chosen_handler) {
                returned = chosen_handler.handle(source, this.getInit())
            }
            
            if (this.config.proxy) {
                return this
            }
            return returned
        },
        
        getInit: function(){
            var init = this.init ? $.extend({}, this.init) : {};
            if (!init['auth']) {
                init['auth'] = this.getAuth();
            }
            if (!init['host']) {
                init['host'] = this.getHost();
            }
            if (!init['log']) {
                init['log'] = this.getLog();
            }
            if (!init['source']) {
                init['source'] = this.config.source;
            }
            
            init['state'] = this.getState();
            init['handle'] = this;
            return init
        },

        executeHandler: function(callback, handler){
            var init = this.getInit();
            if (typeof(handler) == 'object' && handler.length) {
                $.extend(init, handler[1]);
                handler = handler[0];
            }

            this.handler = new handler(init);
            if (callback) {
                callback(this.handler);
            }
            return this.handler
        },
    
    
        parseSourceHandler: function(source, default_handler, callback){
            if (default_handler) {
                return default_handler
            }else{
                console.log(source, default_handler);
                throw Error('TODO: implement handlesApiHandle.parseSourceHandler()')
                // TODO: callback(handler) is called after loading Handler
            }
        },

        execute: function(method, options){
            if (this.handler[method]){
                return this.handler[method](options)
            }else{
                console.log(method, options);
                throw Error('TODO: ApiHandle.execute() with handler[method] == undefined')
            }
        }, 
        
        setResource: function(resource){
            this.resource = resource;
        },
        
        getResource: function(){
            if (this.resource){
                return this.resource;
            }
            
            if (this.isReady()) {
                return this.getHost().provide(this, {'return': 'Resource'})
            }
            return undefined
        },
        
        isReady: function(){
            return Boolean(this.source || this.resource)
        },
        
        getList: function(){
            if (this.resource){
                return this.resource;
            }
            
            
            if (this.isReady()) {
                return this.getHost().provide(this, {'return': 'List'})
            }
            return undefined
        },
    });

    
    var ApiHandlerPrototype = {
        __init: function(config, init){
            ApiHandle.prototype.__init.apply(this, arguments);
            this.source = null;
            if (this.init && !$.isEmptyObject(this.init)) {
                this.handle(this.init);
            }
            
        },
        
        getHandle: function(){
            return this.config.handle
        },
        
        getInit: function(){
            return this.config;
        },
        
        handle: function(source, handler){
            var config = typeof(handler) == 'object' ? handler : undefined;
            handler = config === undefined ? handler : config.handler;

            if (this == source && config) {
                if (config.handle === this.config.handle) {
                    return this
                }
                return this.asClone(config).handle(this.source)
            }
            throw Error('TODO: implement ApiHandler.handle() for ' + this.__proto__.constructor.name + '. ' + source)
            this.source = source;
        },
        
        handle_refresh: function(config){
            if (this.config.refreshHandler) {
                this.config.refreshHandler(config);
            }
        },
        
        getAuth: function(){
            return this.config.auth
        },
        
        getHost: function(){
            return this.config.host
        },
        
        getLog: function(){
            return this.config.log
        },
        
        asIdentifier: function(){
            if (this.source.asIdentifier) {
                return this.source.asIdentifier()
            }
            return this.source
        },
    };
    
      
    
    function ListHandler(config) {
        if (this.__init) {
            // new ()
            this.__init.apply(this, arguments)
        }else{
            //     ()
            return [ListView, config]
        }
    }
    
    $.extend(ListHandler.prototype, ApiHandle.prototype);
    $.extend(ListHandler.prototype, ApiHandlerPrototype, {
        handle: function(source, handler){
            _log(this.getLog(), 'debug', ['[IntrospectiveApi]', '[ListHandler]', '(handle)', source, handler]);
            var config = typeof(handler) == 'object' ? handler : undefined;
            handler = config === undefined ? handler : config.handler;

            if (this == source && config) {
                return this.asClone(config).handle(this.source)
            }
            var $this = this;
            if (Array.isArray(source)) {
                throw Error('TODO: implement ListHandle.handle for Arrays')
            }else if (typeof source == 'object') {
                if (source.__proto__ && source.__proto__.constructor != Object) {
                    this.setResource(source.getList())
                }else{
                    console.log(source)
                    throw Error('TODO: implement ListHandle.handle for objects')
                }
            }else if (typeof source == 'string') {
                this.setResource(this.getHost().provide(this.asRequest(source), {
                    'return': 'List'
                }))
                //return ResourceMixin{}
            }else{
                return ApiHandlerPrototype.handle.apply(this, arguments);
                //resource = this.options.source.get_resource()
                //this._source = 
            }
            this.source = source;
            this.getList().load(function(result){
                var showEmptyList = true;
                if (result.getList().length() || showEmptyList) {
                    this.handle_refresh({
                            view: 'list',
                            source: $this
                      });
                }else{
                    var resource = $this.getList().new();
                    resource.bind('post-create', function(list, event, result){
                        list.add(result.get());
                        this.handle_refresh({
                            view: 'list',
                            source: this
                        })
                    }.bind(this, result.getList()))
                    
                    this.handle_refresh({
                            view: 'edit',
                            source: resource  // TODO: new CreateHandler(this.getInit()?).handle(resource);
                    });
                }
            }.bind(this))
            return this
            
        },
        
        prepare: function(config, callback){
            var prepared;
            
            prepared = this.getResource().getContent('json');
            //console.log(prepared)
            
            if (false) {
                //callback(prepared)
                return undefined
            }
            return prepared
        },

        getResource: function(){
            return this.getList();
        },

        getList: function(){
            return this.resource
        }
    })
      
    function DetailHandler(config) {
        if (this.__init) {
            // new ()
            this.__init.apply(this, arguments)
        }else{
            //     ()
            return [DetailHandler, config]
        }
    }
    
    $.extend(DetailHandler.prototype, ApiHandle.prototype);
    $.extend(DetailHandler.prototype, ApiHandlerPrototype, {
        __init: function(){
            ApiHandlerPrototype.__init.apply(this, arguments)
            this.setResource(null);
        },
        handle: function(source, handler){
            _log(this.getLog(), 'debug', ['[IntrospectiveApi]', '[DetailHandler]', '(handle)', source, handler]);
            var $this = this;
            var config = typeof(handler) == 'object' ? handler : undefined;
            handler = config === undefined ? handler : config.handler;

            if (this == source && config) {
                return this.asClone(config).handle(this.source)
            }
            
            if (Array.isArray(source)) {
                throw Error('TODO: implement DetailHandler.handle for Arrays')
            }else if (source && typeof source == 'object') {
                if (source.__proto__ && source.__proto__.constructor != Object) {
                    this.setResource(source.getResource())
                }else if (source.uri || source.url){
                    this.source = source;
                    this.setResource(this.getHost().provide(this.asRequest(source), {
                        'return': 'Resource'
                    }))
                }else  if (this.getInit().initialValue && source.pk && true){  // TODO: use a config setting to decide if its allowed
                    this.source = source;
                    source = $.extend({uri: this.getInit().initialValue + '/' + source.pk}, source)
                    this.setResource(this.getHost().provide(this.asRequest(source), {
                        'return': 'Resource'
                    }))
                }else {
                    console.log(source)
                    throw Error('TODO: implement DetailHandler.handle for objects')
                }
            }else if (typeof source == 'string') {
                this.source = source;
                this.setResource(this.getHost().provide(this.asRequest(source), {
                    'return': 'Resource'
                }))
            }else{
                return ApiHandlerPrototype.handle.apply(this, arguments);
                //resource = this.options.source.get_resource()
                //this._source = 
            }
            this.source = source;

            this.getResource().load(function(result){
                if (result.wasSuccessfull) {
                    $this.handle_refresh({
                            view: 'detail',
                            source: $this
                    })
                }else{
                    /*this.getHost().handle(new handles.CreateHandler(this.getInit()).handle(this.source), {
                        'return': 'Resource'
                    })*/
                    $this.getResource().bind('post-create', function(event, result){
                        $this.setResource(result.getResource());
                        $this.handle_refresh({
                            view: 'detail',
                            source: $this
                        })
                    })
                    this.handle_refresh({
                            view: 'edit',
                            source: $this
                    });
                }
              
            }.bind(this))
            return this
        },
    })
    
      
    function CreateHandler(config) {
        if (this.__init) {
            // new ()
            this.__init.apply(this, arguments)
        }else{
            //     ()
            return [CreateHandler, config]
        }
    }
    
    $.extend(CreateHandler.prototype, ApiHandle.prototype, ApiHandlerPrototype, {
        handle: function(source, config){
            _log(this.getLog(), 'debug', ['[IntrospectiveApi]', '[CreateHandler]', '(handle)', source, config]);
            
            
            
            if (source === undefined || typeof(source) == 'string'){
                
                console.warn('create handler just mockup')
                var settings = {
                    done: function(){
                        this.handle_refresh({
                                view: 'edit',
                                source: this
                        });
                    }.bind(this),
                    fail: function(){throw Error('TODO: fail handler')}
                };
                settings['uri'] = source || '/';
                this.source = settings['uri'];
                this.applyState(settings);
                source = this.getHost().provide(settings, {'return': 'Resource'});
                this.getHost().discover(settings);
            }

            if (typeof(source) == 'object' && typeof(source.getResource) == 'function') {
                this.source = source;
                this.setResource(source.getResource())
                this.getResource().bind('post-create', function(event, result){
                    this.getBaseHandle().handle(result.getResource())
                }.bind(this))
                this.getResource().discover(function(){
                    this.handle_refresh({
                            view: 'edit',
                            source: this
                    });
                }.bind(this));
                return this
            }
            
            return ApiHandlerPrototype.handle.apply(this, arguments)
        }
    })
    
    function PendingHandler(config) {
        if (this.__init) {
            // new ()
            this.__init.apply(this, arguments)
        }else{
            //     ()
            return [PendingHandler, config]
        }
    }
    
    $.extend(PendingHandler.prototype, ApiHandlerPrototype, {
    })
    
      
    function AutoHandle(config) {
        if (this.__init) {
            // new ()
            this.__init.apply(this, arguments)
        }else{
            //     ()
            return [AutoHandle, config]
        }
    }
    
    $.extend(AutoHandle.prototype, ApiHandle.prototype, {
        handle: function(source, handler, callback){
            _log(this.getLog(), 'debug', ['[IntrospectiveApi]', '[AutoHandle]', '(handle)', source, handler]);
            var config = typeof(handler) == 'object' ? handler : undefined;
            handler = config === undefined ? handler : config.handler;
            var handle = this;
            if (source == this.handler && source !== undefined) {
                return source;
            }
            
            if (source === undefined && this.init.initialValue) {
                source = handle.init.initialValue ;
            }else if (typeof(source) !== 'string' && this.handler && this.init.initialValue) {
                var id = this.handler.getResource().__getID(source);
                source = handle.init.initialValue + (id ? id + '/' : '');
            }else if (typeof(source) == 'object' && source.pk && this.init.initialValue) {
                source = handle.init.initialValue + (source.pk ? source.pk + '/' : '');
            //    console.log(resource);
            //    resource.discover();
            //}else if (typeof(source) !== 'string' && this.handler) {
            //    var resource = this.handler.getResource().get(undefined, source);
            //    console.log(resource);
            //    resource.discover();
            }
            
            if (typeof(source) == 'string'){
                
                console.warn('handler is missing a fail method')
                var settings = {
                    done: this.discoveredHandler.bind(this, source, callback),
                    fail: function(){
                        throw Error('TODO: implement AutoHandler FailHandler')
                    },
                    //force: true  // TODO: result returning cached request doesnt contain needed jqXHR, does it?
                }
                settings['uri'] = source;
                this.source = settings['uri'];
                this.applyState(settings);
                this.getHost().discover(settings);
            }else if (!handler){
                return ApiHandle.prototype.handle.apply(this, arguments)
            }
            this.source = source; 
            if (handler) {// TODO: use callback?
                return this.executeHandler(undefined, handler).handle(source, this.getInit())
            }
            
            return undefined
        },
        
        discoveredHandler: function(source, callback, result){
            var type = result.getResponseType();
            //this.resource = result.get()
            this.executeHandlerType(type, result.get(), callback)
        },
        
        executeHandlerType: function(type, source, callback){
            if (handles[type + 'Handler']) {
                var start_handler = this.executeHandler.bind(this, function(handler){
                    if (callback) {
                        callback(handler);
                    }
                    handler.handle(source);
                });
                var handler = this.parseSourceHandler(source, handles[type + 'Handler'], start_handler);
                if (handler) {
                    start_handler(handler);
                }
            }else{
                throw Error('TODO: implement Handler for ViewType: ' + type)
            }
        }
    })
    
    handles = {
        ApiHandle: ApiHandle,
        AutoHandle: AutoHandle,

        CreateHandler: CreateHandler,
        ListHandler: ListHandler,
        DetailHandler: DetailHandler,
    }
    
    return handles;
});