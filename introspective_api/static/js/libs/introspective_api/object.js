define(['jquery', 'introspective-api-log', 'json'], function ($, _log, JSON) {
    LINK_HEADER_TARGETS = ['link', 'relationship']
    function unpackURL(url, data) {        
        if (url.indexOf('{') != -1){
            for (var substitut in data) {
                if (data[substitut] != undefined) {
                    url = url.replace('{' + substitut + '}', data[substitut]);
                }                    
            }   
        }
        return url
    }
    function parseLinkHeader(link_header) {
            link_header_expr = /<([a-z:/\-0-9\.?&_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-?= ]*)",?)*/g
            links = {}
            while (link = link_header_expr.exec(link_header)){
                name = link[3] ? link[3] : link[2];
                links[name] = link[1];
            }
            return links
    };
    function parseLinkTemplateHeader(header) {
        templatelink_header_expr = /<([a-z:{}/\-0-9\.?&_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-?= ]*)",?)*/g
        links = {}
        while (link = templatelink_header_expr.exec(header)){
            name = link[3] ? link[3] : link[2];
            links[name] = link[1];
        }
        return links
    };
    function isEmpty(obj){
        for (var key in obj) {
            return false
        }
        return true
    }
    function ApiObjectEvent() {
        this.init.apply(this, arguments)
    }
    $.extend(ApiObjectEvent.prototype, {
        init: function(name){
            this.name = name;
        }
    })
    
    // event.subEvent
    // => every time an subEvent is called, the event is called some time afterwards (it may take several subevents until event is called)
    var apiObjectEvents = {
        
        // callback(event, apiResult)
        'initialized': {},
        'post-save': {},
        //'post-save-related': {},
        'post-add': {},
        'post-create': {},
        'post-load': {
            'post-refresh': {}
        },
        'post-discover': {},
        'post-delete': {},
        'set-fixture': {},
        
        // callback(event, apiResult)
        'start-loading': {
            'load-more': {}
        },
        'finished-loading': {
            'loaded-one': {}
        },

        // callback(event, apiObject)
        'replaced': {},

        // callback(event, target, value)
        'changed': {},

        // callback(event, format, content)
        'updated': {},

        // callback(event, apiObject)
        'accessed-related': {},
        'accessed-attribute': {},
        'accessed-unknown': {},
        'accessed-clone': {}
    }
        
    function ApiResult() {
        this.init.apply(this, arguments);
    };
    
    $.extend(ApiResult.prototype, {
        
        init: function(obj, raw, action){
            this.raw = raw || false;
            this.results= [];
            this.obj= obj;
            this.settings= {};
            this.wasSuccessfull= undefined;
            this.request= {};
            this.ajaxID= null;
            this.response = undefined;
            this.responseText = undefined;
            this.action = action;
            this.jqXHR = undefined;
        },
        
        registerRequest: function(ajaxID, request){
            this.ajaxID = ajaxID,
            $.extend(this.request, request);
        },
        
        registerSettings: function(settings){
            $.extend(this.settings, settings);
        },
        
        registerResult: function(result){            
            this.setStatus('', '', result.wasSuccessfull);
            this.results.push(result);
        },
        
        getResponse: function(){ // TODO
            return JSON.parse(this.responseText) || this.response
        },
        
        registerSuccess: function(response, status, jqXHR){
            if (this.raw) {
                this.response = response;
            }{
                this.responseText = jqXHR.responseText;
            }
            this.jqXHR = jqXHR;
            this.setStatus('ok', status, true);
        },
        
        registerFailure: function(jqXHR, status, error){
            this.responseText = jqXHR.responseText;
            this.jqXHR = jqXHR;
            this.setStatus('failed', error, false);
        },
        
        wasCached: function(responseText){
            if (this.raw) {
                this.response = responseText;
            }else{
                this.responseText = responseText;
            }
            this.setStatus('ok', 'cached', true);
        },
        
        setStatus: function(status, statusText, success){
            this.status = status;
            this.statusText = String(statusText).toLowerCase();
            
            if (this.wasSuccessfull === undefined){
                this.wasSuccessfull = success;
            }else{
                this.wasSuccessfull = this.wasSuccessfull && success;
            }
        },
        
        getFormat: function(){
            if (this.settings.format === undefined){
                // pass
            }else if (typeof this.settings.format == 'string'){
                return this.settings.format
            }else if (this.settings.format instanceof Object) {
                if (typeof this.settings.format.format == 'string') {
                    return this.settings.format.format
                }
            }
            
            return 'json';
        },
        
        getContent: function(format){
            if (this.raw) {
                return this.response
            }else{
                if (format === undefined) {
                    format = this.getFormat();
                }
                return this.obj.__onLoad(format);                
            }
        },
        
        getObject: function(){
            return this.obj.__onGet(true);
        },
        
    });
        
    function Path() {
        this.init.apply(this, arguments);
    };
    
    $.extend(Path.prototype, {        
        init: function(parent, target, _data){
            this.path = new Array();
            this.links = undefined;
            if (_data instanceof Object) {  
                var data = _data;             
            }else{
                var data = {};
                if (_data != undefined) {
                    data[target] = _data;
                } 
            }
            
            if (parent != null) {
                for (var pathMember in parent.path){
                    this.path.push(parent.path[pathMember]);
                };
            }
            this.target = target;
            this.data = data;
            
            this.path.push(this);
        },
        getURIs: function(sitemap){
            if (this.links) {
                return this.links
            }
            var active = sitemap;
            var data = {}
            for (var urlPartIndex in this.path){
                var urlPart = this.path[urlPartIndex];
                $.extend(data, urlPart.data);
                if (urlPart.target) {
                    new_active = active[urlPart.target];
                    if (new_active === undefined && LINK_HEADER_TARGETS.indexOf(urlPart.target) != -1) {
                        new_active = active[urlPart.data];
                    }
                    active = new_active || {};  // TODO: this is to prevent error on undefined links (new_active == undefined)
                                                // but what should really happen if this happens? error?
                }
                
            };
            var links = {};
            for (var link in active) {
                url = active[link]['.'];
                if (url) {
                    links[link] = unpackURL(url, data)
                }                
            }
            this.links = links;
            return links
        }
    });
    
    function ApiObject() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiObject.prototype, {   
        
        __reset_obj:  function(initialContent){
            if (initialContent === undefined) {
                initialContent = {}
            }

            this.__data = {};
            this.__unresolvedData = {};
            this.__links = {};
            this.__URIlinks = {};
            this.__URLlinks = {};
            
            this.__syncedContent = {'json': $.extend(true, new initialContent.constructor(), initialContent)};
            this.__content = {'json':initialContent};
            this.__objects = {};
            this.__unevaluatedObjects = {};
            this.__domElements = [];
            
            this.__uncommitted = {};
            this.__committing = {};
            
            this.__format = 'json';
            this.__sync = [];               
            this.__loading = 0;
            this.__initialized = false;
            this.__initializing = undefined;
            this.__saving = false;
            this.__status = {};
            this.__path = null;
            this.__info = {}
        },
        
        __init: function(settings){
            // settings:
            var apiClient = settings.apiClient,
                parent = settings.parent,
                target = settings.target,
                data = settings.data,
                asClone = settings.asClone,
                initialContent = settings.initialContent,
                url = settings.url;
            
            this.setLog(settings.log || null);
            this.__is_blank = settings.isBlank || false;
            this.__event_handler = {};
            this.__reset_obj(initialContent);
            
            
            this.__apiClient  = apiClient;
            this.__path       = parent ? parent.__path : null;
            if (!asClone && target){
                this.__updatePath(target, data, url);
            }else{
                this.__data       = data;
                if (this.__path) {
                    this.__updateURILinks();
                }
                if (!target) {
                    this.__unresolvedData = data;
                }
                if (url) {
                    this.__updateURLLinks({'.': url});
                }
            }

        },
        
        __updateURILinks: function(){
            var $this = this;
            var data = {}
            for (var entry in $this.__content['json']) {
                data[entry] = $this.__content['json'][entry];
            } // todo: really??
            // todo also include objects - data[object_name] = object.data??
            
            
            function addLink(link, url) {
                url = unpackURL(url, data);
                $this.__URIlinks[link] = url;
                if ($this.__links[link] === undefined) {
                    $this.__links[link] = url;
                }
            }
            
            var URIs = this.__path.getURIs($this.__apiClient.getSitemap());
            for (var link in URIs){
                addLink(link, URIs[link]);
            }
        },
        
        /* URLLinks are links from the Response Header.
         * depending links ONLY substitute from resource attributes */
        __updateURLLinks: function(additionalLinks){
            var $this = this;
            var data = {};
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(updateURLLinks)', 'additional links', additionalLinks, this])
            for (var entry in $this.__content['json']) {
                data[entry] = $this.__content['json'][entry];
            }
            /*for (var urlPartIndex in $this.__path.path){
                var urlPart = $this.__path.path[urlPartIndex];
                data[urlPart.target] = urlPart.data;
            };*/
            
            function addLink(link, url) {
                if (url.indexOf('{') != -1){
                    for (var substitut in data) {
                        if (data[substitut] != undefined) {
                            url = url.replace('{' + substitut + '}', data[substitut]);
                        }                    
                    }   
                }
                $this.__URLlinks[link] = url;
                $this.__links[link] = url;
            }
            
            for (var link in additionalLinks){
                addLink(link, additionalLinks[link]);
            }
            
        },
        
        __asURL: function(target, data){
            if (LINK_HEADER_TARGETS.indexOf(target) != -1 && data && data[target] && this.__URLlinks[data[target]]) {
                return this.__URLlinks[data[target]]
            }
            if (target && this.__URLlinks[target]) {
                return this.__URLlinks[target]
            }
            
            var links = this.__URLlinks;
            var url = '';
        
            if (links['.']) {
                url = links['.'];
                if (url === undefined) {
                    throw Error('this one is not accessible')
                }
                if (url.indexOf('{') != -1) {
                    throw Error('provided data  does not match')
                }
                return url
            }else{
                //?
            }
            
            return null;
        },
        
        __asURI: function(target, data){
            if (target && this.__URIlinks[target]) {
                if (data && LINK_HEADER_TARGETS.indexOf(target) != -1 && data[target]) {
                    return unpackURL(this.__URIlinks[target], data)
                }
                return this.__URIlinks[target]
            }
            
            if (data && LINK_HEADER_TARGETS.indexOf(target) != -1 && data[target] && this.__URIlinks[data[target]]) {
                return this.__URIlinks[data[target]]
            }
            
            var url = '';            
            for (var urlPart in this.__path.path){
                var path = this.__path.path[urlPart];
                var part = path.target;
                if (path.data[path.target] != undefined) {
                    part = path.data[path.target];
                }
                url += '/' + part;
            };
            url += '/';
            return url;
        },
        
        __asResult: function(action, settings, raw){
            var result = new ApiResult(this, raw, action);
            result.registerSettings(settings);
            return result
        },
        
        __isCreated: function(){// todo
            return this.__sync.length > 0 && this.__data;
        },
        
        __isBlank: function(){// todo
            return this.__is_blank;
        },
        
        __updatePath: function(target, data, url){
            if (data) {
                if (!this.__data) {
                    this.__data = {}
                }
                this.__data[target] = data[target];
            }
            this.__path = new Path(this.__path, target, this.__data);
            //this.__links = {};
            this.__updateURILinks();
            var new_url = url || this.__asURL(target);
            if (new_url){
                this.__updateURLLinks({'.': new_url});
            }
        },
        
        __new: function(settings){ // ApiObject
            var $this = this;
            if (settings === undefined) {
                settings = {}
            }
            var log = settings.log || this.__log,
                target = settings.target;
            delete settings.target;
            var new_instance = this.__get(settings);//new LinkedResource({apiClient:this.__apiClient, parent:this, data:null, target:null, asClose:true, initialContent:settings.initialContent, log:log});
            //this.__trigger('accessed-clone', [new_instance])
            new_instance.__initialized = true;
            new_instance.__trigger('initialized', [])
            new_instance.__bind('post-create', function(event, result){
                if (result.wasSuccessfull) {
                    new_instance.__updatePath(target, result.obj.__syncedContent['json']);
                }
            })
            return new_instance
        },
        __create: function(data, callback){ // TODO: update path as well here?
            var $this = this;
            obj = new LinkedResource({apiClient:this.__apiClient, parent:this, target:null, data:data, asClone:true, initialContent:data, log: this.__log});
            request = {
                data: data,
                type: 'post',
                isApiInternal: true,
                
            }
            var result = obj.__asResult('create', {data:data, callback:callback});
            request.done = function(response, status, jqXHR){
                $this.__finishedLoading(result);
                result.registerSuccess(response, status, jqXHR); 
                obj.__updateFromResponse(response, result);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('post-create', [result]);
            }
            request.fail = function(jqXHR, statusText, errorThrown){
                $this.__finishedLoading(result);
                result.registerFailure(jqXHR, statusText, errorThrown);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('post-create', [result]);
            }
            
            this.__setURL(request);
            var requestSettings = {log: this.__log};
            this.__startLoading(result);
            var ajaxID = this.__apiClient.add(request, requestSettings);            
            obj.__sync.push(ajaxID);
            result.registerRequest(ajaxID, request);
            return obj
        },
        
        __setURL: function(request, target){
            var data = {}
            $.extend(data, this.__unresolvedData);
            if (request.data) {
                $.extend(data, request.data);
            }
            request.data = data;
            
            var url = this.__asURL(target);
            if (url) {
                request.url = url
            }else{
                var uri = this.__asURI(target);
                if (uri) {
                    request.uri = uri;
                }else{
                    throw Error('has neither uri nor url');
                }
            }
        },
        
        __checkContent: function(_target){
            for (var target in this.__content['json']) {
                if (_target && _target !== target) {
                    continue
                }
                if (JSON.stringify(this.__syncedContent['json'][target]) !== JSON.stringify(this.__content['json'][target])) {
                    this.__update(target, this.__content['json'][target]);
                }
            }
            if (this.__uncommitted.length === 0 && this.__syncedContent['json'].length == this.__content['json'].length) {
                return
            }
            for (var target in this.__syncedContent['json']) {
                if (_target && _target !== target) {
                    continue
                }
                if (!this.__content['json'].hasOwnProperty(target) && !this.__uncommitted.hasOwnProperty(target)) {
                    this.__update(target, null);
                }
            }
        },
        
        
        __save: function(callback){    
            var $this = this;            
            var apiClient = $this.__apiClient;
            var todo = 1; // starting at 1!!
            var sync_obj;
            var settings = {callback: callback},
                isCreated = this.__isCreated();
            
            var result = this.__asResult('save', settings);
            
            function onChange(target, new_state){
                return; //todo?
                return status_change($this.__get(target), new_state);
            }
            
            function finishedOne(childrenResult) {
                todo -= 1;
                result.registerResult(childrenResult)
                if (todo == 0 && callback instanceof Function) {
                    callback(result);
                }
                if (isCreated) {
                    $this.__trigger('post-save', [result]);
                }else{
                    $this.__trigger('post-create', [result]);
                }
            }
        
            if ($this["saving"] == true) {
                throw Error('already saving, wait');
                //$this.__abort($this.__committing[target])
            }
            this.__checkContent()
            var data = {};
            var seperateRequest = [];
            var saveObject = false,
                values = [];
            for (var target in $this.__uncommitted) {
                //if (!$this.__syncedContent['json'].hasOwnProperty(target)) { //  
                    //if (!$this.__objects[target].__isCreated()) {
                    //    seperateRequest.push(target);
                    //};
                if ($this.__objects[target] && !($this.__objects[target] instanceof ResourceAttribute) && !(this instanceof LinkedRelationship)) {
                    if ($this.__objects[target].needsSave()){
                        $this.__objects[target].save();
                    }
                }else{
                    data[target] = $this.__uncommitted[target];
                    saveObject = true;
                    values.push(target);
                }
                
                $this.__committing[target] = $this.__uncommitted[target];
                delete $this.__uncommitted[target];
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(save)', 'committing', values])
            
            var completeUpdate = undefined;
            for (var entry in data){
                if (data[entry] === undefined){
                    completeUpdate = true;
                    break;
                }
            }
            if (completeUpdate === undefined) {
                for (var entry in $this.__content['json']){
                    if (!data.hasOwnProperty(entry)){
                        completeUpdate = false;
                        break;
                    }
                }
                if (completeUpdate === undefined) {
                    for (var entry in $this.__syncedContent['json']){
                        if (!data.hasOwnProperty(entry)){
                            completeUpdate = false;
                            break;
                        }
                    }
                }
            }
            if (completeUpdate === undefined) {
                completeUpdate = true
            }
            
            function finishedSaving(result, data){
                return function(response, status, jqXHR){
                    $this.__finishedLoading(result);
                    result.registerSuccess(response, status, jqXHR);
                    $this.__updateFromResponse(response, result);
                    
                    for (var target in data) {
                        delete $this.__committing[target];
                    }
                    finishedOne(result);
                }
            }
            
            function failedSaving(result, data){
                return function(jqXHR, status, error){
                    $this.__finishedLoading(result);
                    result.registerFailure(jqXHR, status, error);
                    
                    for (var target in data) {
                        if ($this.__uncommitted[target] === undefined){
                            $this.__uncommitted[target] = data[target];
                        };
                        delete $this.__committing[target];
                    }
                    finishedOne(result);
                }
            }
            /*
            function saveRelated() {
                
                for (target in seperateRequest) {
                    
                    $this.__startLoading()
                    todo += 1;
                    var data = {};
                    data[target] = $this.__committing[target];
                    
                    var request = {
                        type: 'post', // todo
                        data: data,
                        done: function(response, status, jqXHR){
                            finishedSaving(data);
                            $this.__updateFromResponse(response, jqXHR);
                        },
                        isApiInternal: true
                    };
                    $this.__setURL(request, target);
                    var requestSettings = {log: this.__log};
                    sync_obj = apiClient.add(request, requestSettings);
                    
                    var number = $this.__sync.push(sync_obj);
                    $this.__committing[target] = $this.__sync[number];
                    
                    var state = {
                        "status": "found",
                        "timestamp": +new Date()/1000,
                    };
                    $this.__onChange(target, state);
                    onChange(target, state);
                    
                }
                
                // because we started todo = 1;
                finishedOne();
            };*/
            
            if (saveObject) {
                
                if (!isCreated){
                    // it wasn't fetched from server - so it needs to be created
                    method = 'post'
                }else{
                    if (completeUpdate) {
                        method = 'put';
                        data = $.extend(true, new this.__content['json'].constructor(), this.__content['json']);
                    }else{
                        method = 'patch'
                    }
                }
                $this.__startLoading(result);
                todo += 1;
                var request = {
                    type: method,
                    data: data,
                    //data: JSON.stringify(data),
                    //contentType: 'application/json; charset=utf-8',
                    //processData: false,
                    //dataType: 'json',
                    done: finishedSaving(result, data),
                    fail: failedSaving(result, data),                    
                    isApiInternal: true,
                };
                
                $this.__setURL(request);
                var requestSettings = {log: this.__log};
                sync_obj = apiClient.add_urgent(request, requestSettings)
                result.registerRequest(sync_obj, request);
                
                var number = $this.__sync.push(sync_obj);
                for (var target in data) {
                    $this.__committing[target] = $this.__sync[number];
                    var state = {
                        "status": "found",
                        "timestamp": +new Date()/1000,
                    };
                    $this.__onChange(target, state);
                    onChange(target, state);
                }
                
            }else{
                //saveRelated();
                //throw Error('nothing to save');
            }
            
            return this;
        },
        
        __parseFormat: function(format){
            if (typeof format == 'string'){
                return format
            }else if (format instanceof Object) {
                var args = "", _format = undefined;
                for (var entry in format) {
                    if (entry == 'format') {
                        _format = format[entry];
                    }else{
                        args += entry;
                        args += ':';
                        args += format[entry];
                        args += ';';
                    }
                }
                if (_format) {
                    if (args) {
                        return _format + '|' + args
                    }
                    return _format
                }
            }
            
            return 'json'
        },
        
        __getID: function(){
            return this.__data['uuid'] || this.__data['id']
        },
        
        __parseTarget: function(target, data){
            if (false && target == 'relationship'){ // no longer needed
                return data[target]
            }else if (data instanceof Object) {
                var args = "";
                for (var entry in data) {
                    args += entry;
                    args += ':';
                    args += data[entry];
                    args += ';';
                }
                if (args) {
                    return target + '|' + args
                }
            }
            return target
        },
        
        __fromFixture: function(fixture){
            var result = this.__asResult('fixture');
            // TODO: set responseText or what ever is needed
            result.responseText = fixture;
            this.__updateContent($.extend(true, {}, fixture), 'json', false, {format: 'json', replace: true})
            this.__initialized = true;
            this.__initializing = undefined;
            this.__trigger('post-load', [result])
            this.__trigger('initialized', [result])
            this.__trigger('set-fixture', [result])
            return this
        },
        
        __resolveObj: function(targetID, settings){
            var old = this.__objects[targetID],
                $this = this,
                obj,
                _settings = $.extend({}, settings),
                target = LINK_HEADER_TARGETS.indexOf(settings.target) == -1 ? settings.target : settings.data[target],
                accessType;
                
            if (old && !old.__isBlank()) {
                return old
            }
            if (old === undefined || old.__isBlank()) {
                if ($this.__links[settings.target] != undefined || $this.__links[target] != undefined || settings.target == 'relationship' ){ // TODO: only if were on object endpoint!! LINK_HEADER_TARGETS.indexOf(settings.target) != -1){
                    var resource;
                    _settings.url = this.__asURL(settings.target, settings.data);
                    if (settings.target == 'relationship') {
                        resource = new LinkedRelationship(_settings);
                        var relationship = settings.data;
                        if (relationship instanceof Object) {
                            relationship = settings.data.relationship
                        }
                        $this.__objects[relationship] = resource;
                    }else{
                        resource = new LinkedResource(settings);
                    }
                    obj = resource;
                    accessType = "related";
                }else if ($this.__content[target] != undefined) {
                    _settings.data = null;
                    var attribute = new ResourceAttribute(_settings);
                    obj = attribute;
                    accessType = "attribute";
                }else{// && $this.__initialized != true) {
                    if (old && old.__isBlank()) {
                        obj = old;
                    }else{
                        _settings.isBlank = true
                        var placeholder = new ApiPlaceholder(_settings);
                        $this.__unevaluatedObjects[targetID] = settings;
                        obj = placeholder;
                        accessType = "unknown";
                        if (!$this.__initialized) {
                            $this.__bind('initialized', function(){
                                $this.__resolveObj(targetID, settings)
                            })
                        }
                    }
                }
            }
            if (obj !== old) {
                if (old) {
                    old.replaceWith(obj);
                }
                
                if ($this.__unevaluatedObjects[targetID]) {
                    if (obj.__isBlank() && !this.__isBlank()) {
                        // metadata might have changed. check.
                        this.__discover(function(){ // TODO: discover - o get not just the links with value, but all possible
                            for (var targetID in $this.__unevaluatedObjectsObject) {
                                $this.__resolveObj(targetID, $this.__unevaluatedObjectsObject[targetID]);
                            }
                        }); // TODO: force: true
                    } else{
                        delete $this.__unevaluatedObjects[targetID];
                    }
                }
                $this.__objects[targetID] = obj;
                this.__trigger('accessed-' + accessType, [obj])
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(resolveObject)', 'resolving', targetID, 'and', settings, 'from', this, 'to', obj, '(links: ', $.extend({}, this.__links),')'])
            return obj;
        },
        
        __get: function(targetOrSettings, _data, wrapped){
            // init            
            var $this       = this;
            var data        = {};//, callback, onChange, forceLoad
            var target      = null;
            var apiClient   = $this.__apiClient;
            var settings    = {};
            
            
            if ((!_data) && targetOrSettings instanceof Object) {
                $.extend(settings, targetOrSettings);
                target          = targetOrSettings.target;
                _data           = targetOrSettings.data;
            }else{
                target = targetOrSettings;
            }
            var log = settings.log || this.__log;
            
            if (_data instanceof Object) {
                data = _data;
            }else if (_data != null && _data != undefined){
                data[target] = _data;
            }
            var format = this.__parseFormat(settings.format);
            var targetID = this.__parseTarget(target, data);
            
            // logic
            var settings = {
                    apiClient:this.__apiClient,
                    parent:this, target:target,
                    data:data,
                    initialContent:settings.initialContent || $this.__content[target],
                    log:log,
                    //event_handler: settings.event_handler || this.event_handler
                },
                obj;
            
            if (this.__isBlank()) {
                settings.isBlank = true;
                var _placeholder = new ApiPlaceholder(settings);
                this.__bind('replaced', function(event, newParent){
                    _placeholder.replaceWith(newParent.__get(targetOrSettings, _data, wrapped))
                })
                obj = _placeholder;
            }else if (target) {
                //var wasCreated = undefined;
                obj = this.__resolveObj(targetID, settings)
                
                if (obj != undefined) {
                    var state = {
                        "status": "found",
                        "timestamp": +new Date()/1000,
                    };
                    
                    /*if (wasCreated) {
                        wasCreated.__bind('updated', function(event, formatID, content){
                            if ($this.__content[formatID][target] instanceof Object && content instanceof Object) {
                                return // objects are identical, because of initialContent
                            }
                            $this.__content[formatID][target] = content;
                        })
                    }*/
                
                }else{
                    _log(log, 'error', ['target "'+ target +'" not found', targetID]);
                    throw Error('target "'+ target +'" not found');
                }   
            }else{
                // $.extend(true, new content.constructor(), content)
                var content = settings.initialContent || this.__content['json'];
                var clone = new this.constructor({
                    apiClient:this.__apiClient,
                    parent:this,
                    target:null,
                    data:data,
                    asClone:true,
                    initialContent: content,
                    log:log
                });
                this.__trigger('accessed-clone', [clone]);
                obj = clone;
            }
            if (obj.__isBlank() && wrapped === false) {
                _log(log, 'error', ['cannot get unwrapped placeholder ', obj, 'of ', this])
                throw Error('cannot get unwrapped blank resource');
            }
            
            return obj.__onGet(wrapped, format);
            
        },
        
        
        __onGet: function(wrapped, format, onLoad){
            if (format === undefined) {
                format = 'json'
            }            
            if (wrapped === undefined) {
                wrapped = true;
            }
            
            if (wrapped === false) {
                var content = new this.__content[format].constructor();
                
                if (format === 'json') {
                    for (var obj in this.__content[format]) {
                        content[obj] = this.__content[format][obj];               
                    }
                    /* this interferes with lists
                    for (var obj in this.__objects) {
                        if (onLoad) {
                            content[obj] = this.__objects[obj].__onLoad(format)
                            
                        }else{
                            content[obj] = this.__objects[obj].__onGet(wrapped, format)
                        }                    
                    }*/
                    return content
                }else{
                    return this.__content[format]
                }
            }
            return this
        },
        
        __onLoad: function(format){
            return this.__onGet(false, format, true);
        },
        
        __prepare: function(targets, callback){
            // init
            var $this = this;   
            var apiClient = $this.__apiClient;
            var settings = {};
                        
            
            if (!(targets instanceof Array)){
                targets = [targets];
            }
            
            // logic
            var targetLength = targets.length;
            var todo = targetLength;
            
            settings.callback = callback;
            settings.targets = targets;
            
            var result = this.__asResult('prepare', settings);
            
            function finnishTarget(targetResult) {
                todo -= 1;
                
                var callbacks = targetResult.settings.callbacks;
                for (var targetCallbackEntry in callbacks){
                    var targetCallback = callbacks[targetCallbackEntry];
                    if (targetCallback instanceof Function) {
                        targetCallback(targetResult); 
                    } 
                }
                
                result.registerResult(targetResult);
                // when all targets are done, call the prepare callback
                if (todo == 0) {
                    if (callback instanceof Function) {
                        callback(result);
                    }                    
                }
            }
            
            for (var i in targets) {
                var target = targets[i];
                var dependingTargets = null;
                var targetSettings = {}
                
                if (target instanceof Object) {
                    targetSettings = $.extend(targetSettings, target);
                }else{
                    targetSettings['target'] = target;
                };
                if (targetSettings.callbacks === undefined) {
                    targetSettings.callbacks = new Array();
                }
                targetSettings.callbacks.push(targetSettings.callback);
                
                targetSettings.callback = function(result){
                    if (targetSettings.depending != undefined) {
                        result.prepare(targetSettings.depending, function(dependingResult){
                                                                    result.appendResult(dependingResult);
                                                                    finnishTarget(result);});
                    }else{
                        finnishTarget(result);
                    }     
                };
                
                target = $this.__get(targetSettings);                
                target.__load(targetSettings);
            }
            
            return $this;
        },
        
        __discover: function(callbackOrSettings){
            var settings = {};
            
            if (callbackOrSettings instanceof Function) {
                settings['callback'] = callbackOrSettings
            }else{
                $.extend(settings, callbackOrSettings);                
            }
            
            var $this = this;
            
            var result = this.__asResult('discover', settings, true); // raw
            
            
            if (this.__discovering != undefined) {
                //var result = this.__asResult('discover', settings);
                var callbacks = {};
                callbacks.done = function(response, status, jqXHR){
                    result.registerSuccess(response, status, jqXHR);
                    $this.__updateFromResponse(response, result);
                    settings.callback(result);
                }
                callbacks.fail = function(jqXHR, statusText, errorThrown){
                    result.registerFailure(jqXHR, statuText, errorThrown);
                    settings.callback(result);
                }
                
                this.__apiClient.registerCallbacksForRequest(this.__discovering, callbacks);
                
            }else if (this.__discovered && (settings.forceReload === undefined || settings.forceReload === false)) {
                //var result = this.__asResult('discover', settings);
                result.wasCached($this.__discovered);
                settings.callback(result);
            }else{
            
                $this.__startLoading(result);
                var request = {
                    type: 'options',
                    done: function (response, text, jqXHR) {                
                        $this.__finishedLoading(result);
                        $this.__discovered = response;
                        $this.__discovering = undefined;
                        result.registerSuccess(response, text, jqXHR);
                        if (settings.callback instanceof Function) {
                            settings.callback(result); 
                        }
                        $this.__trigger('post-discover', [result]);         
                
                    },
                    fail: function (jqXHR, statuText, errorThrown) {                
                        $this.__finishedLoading(result);
                        result.registerFailure(jqXHR, statuText, errorThrown);
                        if (settings.callback instanceof Function) {
                            settings.callback(result);      
                        }  
                        $this.__trigger('post-discover', [result]);
                    },
                    isApiInternal: true
                };
                $this.__setURL(request);
                if (settings.format) {
                    var format = settings.format;
                    if (typeof format == 'string') {
                        format = {format: format};
                    }
                    request.dataType = format.format;
                    delete format.format
                    for  (var arg in format) {
                        // todo: ass query args
                    }
                }
                var requestSettings = {log: settings.log || this.__log};
                var ajaxID = $this.__apiClient.add(request, requestSettings);
                if ($this.__discovering === undefined) {
                    $this.__discovering = ajaxID;
                };          
                $this.__sync.push(ajaxID);
                result.registerRequest(ajaxID, request);
            }
            
            return result
        },
        
        __load: function(callbackOrSettings){
            var settings = {};
            var $this = this;
            if (callbackOrSettings instanceof Function) {
                settings.callback = callbackOrSettings
            }else if (callbackOrSettings instanceof Object) {
                $.extend(settings, callbackOrSettings);
            }else{
                throw Error('load needs a callback or settings obj')
            }
            
            if (this.__initializing != undefined) {
                var result = this.__asResult('load', settings);
                var callbacks = {};
                callbacks.done = function(response, status, jqXHR){
                    result.registerSuccess(response, status, jqXHR);
                    if (settings.callback)settings.callback(result);
                }
                callbacks.fail = function(jqXHR, statusText, errorThrown){
                    result.registerSuccess(jqXHR, statusText, errorThrown);
                    if (settings.callback)settings.callback(result);
                }
                
                // TODO: it can happen that the id is completed, the time this method executes! (had this case)
                this.__apiClient.registerCallbacksForRequest(this.__initializing, callbacks);
                
            }else if (!settings.format && this.__initialized && (settings.forceReload === undefined || settings.forceReload === false)) {
                var result = this.__asResult('load', settings);
                result.wasCached();
                if (settings.callback) settings.callback(result);
                $this.__trigger('post-load-from-cache', [result]);
            }else{
                settings.returnResult = true;
                result = this.__refresh(settings);
                var callbacks = {};
                callbacks.done = function(response, status, jqXHR){
                    $this.__trigger('post-load', [result]);
                }
                callbacks.fail = function(jqXHR, statusText, errorThrown){
                    $this.__trigger('post-load', [result]);
                }
                this.__apiClient.registerCallbacksForRequest(result.ajaxID, callbacks);
            }      
            return this        
        },
        
        __refresh: function(callbackOrSettings){
            var $this = this;
            var settings = {};
            
            if (callbackOrSettings instanceof Function) {
                settings.callback = callbackOrSettings;
            }else if (callbackOrSettings instanceof Object){
                $.extend(settings, callbackOrSettings);
            }else throw Error('".refresh()" need callback or settings attr')
            
            if (settings.loadContent === undefined) {
                settings.loadContent = true;
            }
            
            var result = this.__asResult('refresh', settings);
            
            
            $this.__startLoading(result);
            var request = {
                type: settings.loadContent ? 'get' : 'head',
                done: function (response, text, jqXHR) {                       
                    $this.__finishedLoading(result);
                    result.registerSuccess(response, text, jqXHR);      
                    $this = $this.__updateFromResponse(response, result, settings); 
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }   
                    $this.__trigger('post-refresh', [result]);            
            
                },
                fail: function (jqXHR, statuText, errorThrown) {                
                    $this.__finishedLoading(result);
                    result.registerFailure(jqXHR, statuText, errorThrown);
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }
                    $this.__trigger('post-refresh', [result]);
                },
                isApiInternal: true
            };
            $this.__setURL(request);
            if (settings.format) {
                var format = settings.format;
                if (typeof format == 'string') {
                    format = {format: format};
                }
                request.dataType = format.format;
                delete format.format
                for  (var arg in format) {
                    // doto: ass query args
                }
            }
            var requestSettings = {log: settings.log || this.__log};
            var ajaxID = $this.__apiClient.add(request, requestSettings);
            $this.__sync.push(ajaxID);
            result.registerRequest(ajaxID, request);
            if ($this.__initializing === undefined && settings.loadContent) {
                $this.__initializing = ajaxID;
            };            
            
            if (settings.returnResult) {
                return result
            }
            return $this
        },
        
        __delete: function(callbackOrSettings){
            var $this = this;
            var settings = {};
            if (this.__isCreated() != true) {
                throw Error('not created yet') // TODO
            }
            if (callbackOrSettings instanceof Function) {
                settings.callback = callbackOrSettings;
            }else if (callbackOrSettings instanceof Object){
                $.extend(settings, callbackOrSettings);
            }
            
            var result = this.__asResult('delete', settings);
            
            
            $this.__startLoading(result);
            var request = {
                type: 'delete',
                done: function (response, text, jqXHR) {                             
                    $this.__finishedLoading(result);
                    result.registerSuccess(response, text, jqXHR);
                    $this = $this.__updateFromResponse(response, result, settings); 
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }   
                    $this.__trigger('post-delete', [result]);
                    $this.__reset_obj();
                },
                fail: function (jqXHR, statuText, errorThrown) {                
                    $this.__finishedLoading(result);
                    result.registerFailure(jqXHR, statuText, errorThrown);
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }
                    $this.__trigger('post-delete', [result]);
                },
                isApiInternal: true
            };
            $this.__setURL(request);
            var requestSettings = {log: settings.log || this.__log};
            var ajaxID = $this.__apiClient.add(request, requestSettings);
            $this.__sync.push(ajaxID);
            result.registerRequest(ajaxID, request);
            return $this
        },
        
        __replaceContent: function(content, dataType, uncommitted, settings){
            settings = settings || {};
            settings.replace = true;
            this.__updateContent(content, dataType, uncommitted, settings);
        },
        
        __updateContent: function(content, dataType, uncommitted, settings, result){
            if (uncommitted === undefined) {
                uncommitted = true;
            }
            if (settings === undefined) {
                settings = {};
            }
            if (!settings.replace && (!content || (content instanceof Object && isEmpty(content)))) {
                return this
            }
            var log = settings.log || this.__log;
            var formatID = this.__parseFormat(settings.format);
            var format = formatID.split('|')[0];
            if (format && dataType.indexOf(format) == -1) {
                if (content[format] != undefined) {
                    return this.__updateContent(content[format], settings.format, uncommitted, settings)
                }
                throw Error('response had invalid dataType (' + dataType + '). Need ' + formatID) // todo
            }
            if (settings.replace) { // TODO: this is no replacement...
                if (format == 'json') {
                    for (var target in this.__content[format]){
                        if (!content || !content.hasOwnProperty(target)) {
                            this.__update(target, undefined, uncommitted)
                        }
                    }
                    if (!uncommitted) { // do it again for synced content TODO: really?
                        for (var target in this.__syncedContent[format]){
                            delete this.__syncedContent[format][target];
                        }
                        /*for (var target in content){//this.__syncedContent[format]){
                            //if (!content.hasOwnProperty(target)) {
                                this.__update(target, undefined, false)
                            //}
                        }*/
                    }
                    
                }
            }
            if (dataType.indexOf('json') != -1) {
                if (content instanceof Array) {
                    for (var entry in content) {
                        // todo: first check storage for cached instance
                        var obj = new ApiObject({apiClient: this.__apiClient, parent: this, target: null, data: content[entry], asClone:true, log:log});
                        obj.__updateContent(content[entry], dataType, uncommitted, settings);
                        obj.__initialized = true;
                        obj.__trigger('initialized', []);
                        var id = obj.__getID();
                        if (id) {
                            // TODO: because introspective api requires UUID, maybe rather use a global __objects storage
                            this.__objects[id] = obj;
                        }
                    }
                    $.extend(this.__content['json'], content);
                }else if (content instanceof Object) {/*
                    for (var entry in content) {
                        var obj = this.__get(entry);
                        if (format == 'json'){// && !content[entry] instanceof Object) {
                            this.__update(entry, content[entry], uncommitted, settings.replace);
                        }
                        obj.__updateContent(content[entry], format, uncommitted, settings);
                    }*/
                    for (var entry in content) {
                        if (format == 'json'){// && !content[entry] instanceof Object) {
                            this.__update(entry, content[entry], uncommitted, settings.replace);
                        }
                    }
                    for (var entry in this.__objects) {
                        var obj = this.__get(entry);
                        obj.__updateContent(content[entry], format, uncommitted, settings);
                    }
                }  
                //$.extend(this.__content['json'], content);
                this.__trigger('updated', [formatID, content]) 
            }else{
                this.__content[formatID] = content;
                this.__trigger('updated', [formatID, content])
            }
            return this
            
        },

        __update_info: function(result){
            var jqXHR = result.jqXHR,
                $this = this;

            if (jqXHR) {
                var ranges = jqXHR.getResponseHeader('Accept-Ranges');
                this.__info.ranges = ranges;
                this.__info.is_list = ranges ? ranges.indexOf('x-records') != -1 : false;
                this.__info.is_resource = !this.__info.is_list;
            }

            if (this.constructor === ApiObject) {
                var clone_config = {
                    apiClient:$this.__apiClient,
                    parent:$this,
                    asClone:true,
                    log:$this.__log,
                    data: $this.__data,
                    target: $this.__target
                },
                    replacement;
                if (this.__info.is_list) {
                    list = this.__get();
                    replacement = new LinkedRelationship(clone_config);
                }else if (this.__info.is_resource) {
                    // TODO: this leads to unacceptable behaviour as it sets this to blank
                    //replacement = new LinkedResource(clone_config);
                }
                if (replacement) {
                    replacement.__updateFromResponse(result.getResponse(), result)
                    $this.__is_blank = true;
                    $this.__replaceWith(replacement);
                }
            }
        },
        
        __updateFromResponse: function(response, result, settings){
            var $this = this;
            var jqXHR = result.jqXHR;
            additionalLinks = {};
            settings = settings || {};
            if (!result.request.type) {
                return _log(settings.log || this.__log, 'warning', ['(IntrospectiveApi)', '(ApiObject)', '(updateFromResponse)', 'result doesnt contain any resquest', result])
            }
            
            this.__update_info(result);
            // todo:
            /*                
                $this.__onChange(target, state);
                if (settings.onChange) settings.onChange(state);*/
            if (result.request.type.toLowerCase() == 'post' && !response) {
                // TODO: check "Location" header and get content from there
                _log(settings.log || this.__log, 'error', ['(IntrospectiveApi)', '(ApiObject)', '(TODO)', 'fetch resource from Location Header'])
            }else{
                settings.replace = ['head', 'patch'].indexOf(result.request.type.toLowerCase()) != -1 ? false : true;
                var data = ['put', 'post', 'patch'].indexOf(result.request.type.toLowerCase()) != -1 ?
                                response || result.request.data
                                : response;
                this.__updateContent(data, jqXHR.getResponseHeader('Content-Type'), false, settings);
                // replacing/updating __syncedContent
                //$this.__syncContent(data, result.request.type.toLowerCase() == 'put' ? true : false);
                this.__checkContent();
                
                // todo store as AttibuteObjects
                /*if (isLink) {
                    $.extend($this['objects'], response)
                }else{
                    $.extend($this['content'], response);
                }        */                           
                

                if (!$this.__initialized) {
                    $this.__initialized = true;
                    $this.__trigger('initialized', [result])
                    $this.__initializing = undefined;
                }
            }     
            if (result.request.type.toLowerCase() == 'post') {
                var location = jqXHR.getResponseHeader('Location');
                if (location){
                    additionalLinks['.'] = location;
                }
            }else if (jqXHR.url) {
                additionalLinks['.'] = jqXHR.url;
            }
            $.extend(additionalLinks, parseLinkHeader(jqXHR.getResponseHeader('Link')));
            $.extend(additionalLinks, parseLinkTemplateHeader(jqXHR.getResponseHeader('Link-Template')));
            this.__updateURLLinks(additionalLinks);
            return $this
        },
         
        __inspect: function(callbackOrSettings){
            var settings = {};
            if (callbackOrSettings instanceof Object) {
                $.extend(settings, callbackOrSettings);
            }else{
                settings['callback'] = callbackOrSettings;
            }
            settings['loadContent'] = false;
            return this.__refresh(settings);
        },
        
        __onChange: function(target, state){
            var $this = this;
            
            if ($this.__status[target] == undefined) {
                $this.__status[target] = $this.__status[target] || [];
            }
            
            $this.__status[target].push(state);
        },
        
        __set: function(target, value, callback){
            var $this = this;
                
            if ($this.__content[target] != undefined) {
                if ($this.__content[target] != value) {
                    $this.__update(target, value);
                }
            }else if ($this.__links[target] != undefined){
                $this.__update(target, value);
            }
            return $this;
        },
        
        __update: function(target, value, uncommitted, replace){
            
            if (this.__content['json'].constructor === Array) {
                return this.__updateArray.apply(this, arguments);
            }else{
                return this.__updateObject.apply(this, arguments);
            }
        },
        
        __updateArray: function(){
            throw Error('use LinkedRelationship therefore');
        },
        __updateObject: function(target, value, uncommitted, replace){
            var $this = this,
                str_value = JSON.stringify(value),
                str_content = JSON.stringify($this.__content['json'][target]),
                str_orig = JSON.stringify($this.__syncedContent['json'][target]);
            uncommitted = uncommitted === undefined ? true : uncommitted;
            replace = replace === undefined ? true : replace;
            //targetObj = $this.__get(target);
            //if (targetObj instanceof ResourceAttribute) {
            //    targetObj.__update(value);
            //}
            if (str_value === str_content === str_orig) {
                return
            }
            
            if (!uncommitted){
                if ($this.__syncedContent['json'].hasOwnProperty(target) && value === undefined) {
                    delete $this.__syncedContent['json'][target];
                }else{
                    if (!replace && value instanceof Object && $this.__syncedContent['json'][target] instanceof Object) {
                        $.extend(true, $this.__syncedContent['json'][target], value);
                    }else{
                        var orig_value = value instanceof Object ? $.extend(true, new value.constructor(), value) : value;
                        $this.__syncedContent['json'][target] = orig_value;
                    }
                }
                str_orig = str_value;
                //this.__trigger('changed-synced', [target, value])
            }
            
            if (uncommitted || !this.__uncommitted.hasOwnProperty(target)) {
                if ($this.__syncedContent['json'].hasOwnProperty(target) && str_orig === str_value) {
                    if ($this.__uncommitted.hasOwnProperty(target)) {
                        delete $this.__uncommitted[target];
                    };
                }else{
                    $this.__uncommitted[target] = value;
                }
                if (value !== undefined) {
                    if (!replace && value instanceof Object && $this.__content['json'][target] instanceof Object) {
                        $.extend(true, $this.__content['json'][target], value);
                    }else{
                        $this.__content['json'][target] = value;
                    }
                }else{
                    delete $this.__content['json'][target];
                }
                
                this.__trigger('changed', [target, value])
            }
            
            
            //if ($this.__uncommitted[target] != undefined){
                //apiClient.abort($this.__uncommitted[target]);
                
            //    this.__uncommitted[target] = $this.__postRequestObject()
            //}
            
        },
        
        __finishedLoading: function(result){
            this.__loading -= 1;
            if (this.__loading == 0) {
                this.__trigger('finished-loading', [result])
            }else{
                this.__trigger('loaded-one', [result])
            }
        },
        
        __startLoading: function(result){
            if (this.__loading == 0) {
                this.__trigger('start-loading', [result])
            }else{
                this.__trigger('load-more', [result])
            }
            this.__loading += 1;
        },
        
        __getContent: function(){
            return this.__content;
        },
        
        __connect: function(domElement, callback){
            domElement = $(domElement);
            this.__domElements.push(domElement);
            
            var inputTargets = new Array();
            $.each(domElement.find(':input'), function(index, elem){
                var name = $(elem).attr('name');
                if (name)inputTargets.push(name);
            });
            if (this.__initialized || self.__data) {
                this.__prepare(inputTargets, function(result){
                    var $this = result.getObject();
                    for (var obj in $this.__objects) {
                        var target = obj.split('|')[0];
                        var input = domElement.find(':input[name="'+target+'"]');
                        if (input.size()) {
                            $this.__objects[obj].connect(input);
                        }
                    }
                    
                        
                    if (callback instanceof Function) {
                        callback(result);
                    }
                })
            }else{
                this.__discover({
                    //data: inputTargets,
                    callback: function(result){
                        var $this = result.getObject();
                        var content = result.getContent();
                        for (var obj in content['actions']['POST']) {
                            var target = obj;
                            var input = domElement.find(':input[name="'+target+'"]');
                            if (input.size()) {
                                $this.__get(target).connect(input);
                            }
                        }
                        
                    },
                });
            };
            
            var submitButton = domElement.find(':submit');
            if (submitButton.size()) {
                var $this = this;
                submitButton.click(function(event){ // on('click.introspective-api-object.'+this.__getID()
                    event.stopImmediatePropagation();
                    try{
                        $this.__save();
                    }catch (e){
                        _log(log, 'error', ['failed saving', e]);
                        console.error(e.stack)
                    }
                    return false;
                });
            }

        },
        
        __disconnect: function(domElement){
            domElement = $(domElement);
            
            domElement.off('.introspective-api-object.'+this.__getID())
            
            for (var element in this.__domElements) {
                if (this.__domElements[element] == domElement) {
                    delete this.__domElements[element];
                }
            }
            
            for (var obj in this.__objects) {
                var target = obj.split('|')[0];
                var input = domElement.find(':input[name="'+target+'"]');
                if (input.size()) {
                    this.__objects[obj].disconnect(input);
                }
            }
            
        },
        
        __hasUnsavedChanges: function(){
            for (var entry in this.__uncommitted) {
                return true
            }
            
            return false;
        },
        
        __asForm: function(target){
            if (target) {
                return this.__get(target).__asForm()
            }
            return null
        },
        
        __replaceWith: function(resource){
            if (resource && resource !== this) {
                this.__trigger('replaced', [resource]);
                // this is ugly, but right now i need this in a framework, that seems to have no chance
                // to catch the event for one use case..
                this._replaced_with = resource; 
            }// todo: if resource === null: blank
            return this
        },
        
        __trigger: function (event_name, args) {
            var event = new ApiObjectEvent(event_name);
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
                if (apiObjectEvents.hasOwnProperty(event_prefix)) {
                    this.__bind(event_prefix, callback);
                    function onChildren(container, __event) {
                        for (var _event in container[__event]){
                            $this.__bind(_event, callback);
                            onChildren(container[__event], _event);
                        }
                    }
                    onChildren(apiObjectEvents, event_prefix)
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
        
        setLog: function(log){
            this.__log = log;
        },
        
        __reset: function(){
            // TODO: reset uncommitted changes
            // this.__checkContent()
            // for target in this.uncommitted
            // content[format][target] = syncedContent[format][target]
            // delete this.uncommitted
        },
        
        reset: function(){
            return this.__reset.apply(this, arguments)
        },
        
        bind: function(){
            return this.__bind.apply(this, arguments)
        },
        
        hasUnsavedChanges: function(){
            return this.__hasUnsavedChanges.apply(this, arguments);
        },
        
        replaceWith: function(){
            return this.__replaceWith.apply(this, arguments)
        },

        isCreated: function(){
            return this.__isCreated.apply(this, arguments)
        },

        isBlank: function(){
            return this.__isBlank.apply(this, arguments)
        },

        get: function(){
            return this.__get.apply(this, arguments)
        },
        
        load: function(){
            return this.__load.apply(this, arguments)
        },
        
        discover: function(){
            return this.__discover.apply(this, arguments)
        },
        
        new: function(){
            return this.__new.apply(this, arguments)
        },
        
        create: function(){
            return this.__create.apply(this, arguments)
        },
        
        destroy: function(){
            return this.__delete.apply(this, arguments)
        },
        
        needsSave: function(target){
            this.__checkContent(target);
            if (target) {
                if (this.__uncommitted.hasOwnProperty(target)) {
                    return true
                }
                if (this.__objects.hasOwnProperty(target)) {
                    return this.__objects[target].needsSave();
                }
            }else{
                for (var x in this.__uncommitted) {
                    if (this.__uncommitted.hasOwnProperty(x)) {
                        return true
                    }
                }
            }
            return false
        },
        
        save: function(){
            return this.__save.apply(this, arguments)
        },
        
        //update: function(){
        //    return this.__update.apply(this, arguments)
        //},
        
        replaceContent: function(new_content, dataType, uncommitted){
            return this.__replaceContent(new_content, dataType || 'json', uncommitted)
        },
        
        updateContent: function(content, dataType, uncommitted){
            return this.__updateContent(content, dataType || 'json', uncommitted)
        },
        
        prepare: function(){
            return this.__prepare.apply(this, arguments)
        },
        
        refresh: function(){
            return this.__refresh.apply(this, arguments)
        },
        
        getContent: function(){
            return this.__getContent.apply(this, arguments)
        },
        
        connect: function(){
            return this.__connect.apply(this, arguments)
        },
        
        disconnect: function(){
            return this.__disconnect.apply(this, arguments)
        },
        
        asForm: function(){
            return this.__asForm.apply(this, arguments)
        },
        
        fromFixture: function(){
            return this.__fromFixture.apply(this, arguments)
        }
        
        
    });
    
    function ResourceAttribute() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ResourceAttribute.prototype, ApiObject.prototype);
    $.extend(ResourceAttribute.prototype, {
        __init: function(settings){
            var apiClient = settings.apiClient,
                parent = settings.parent,
                target = settings.target,
                data = settings.target;
            this.__reset_obj(settings.initialContent);
            this.__apiClient  = apiClient;
            this.__data       = data;
            this.__parent     = parent;
            this.__target_name= target;
            this.__path       = new Path(parent.path, target, data);
            this.__updateURILinks();
        },
        
        __load: function(callbackOrSettings){
            var $this = this;
            var settings = {};
            
            if (callbackOrSettings instanceof Function) {
                settings['callback'] = callbackOrSettings
            }else{
                $.extend(settings, callbackOrSettings);                
            }
            var callback = settings['callback'];
            var result  = this.__asResult('load', settings)
            
            settings.callback = function(parentResult){
                result.registerResult(parentResult);
                if (callback instanceof Function) {
                    callback(result);
                }
                
            }
            
            return this.__parent.__load(settings);
        },
        
        __onGet: function(wrapped, format, onLoad){            
            if (wrapped === undefined) {
                wrapped = true; // really?
            }
            if (wrapped === false) {
                
                return this.__content
            }
            return this
        },
        
        __refresh: function(callbackOrSettings){
            var $this = this;
            var settings = {};
            
            if (callbackOrSettings instanceof Object) {
                $.extend(settings, callbackOrSettings);
            }else{
                settings['callback'] = callbackOrSettings
            }
            var callback = settings['callback'];
            
            var result = this.__asResult('refresh', settings);
            settings.callback = function(parentResult){
                result.registerResult(parentResult);
                callback(result);
            }
            
            return this.__parent.__refresh(settings);
        },
         
        __updateContent: function(content){
            this.__content['json'] = content;
        },
        
        __update: function(newContent){
            var $this = this;
            if (JSON.stringify(newCOntent) === JSON.stringify(this.__content['json'])) {
                return
            }
            $this.__updateContent(newContent);
            
            var content = $this.__onGet(false);
            $this.__parent.__update($this.__target_name, content)
            $this.__updateConnected(content);
        },
        
        __save: function(){
            this.__parent.__save() // todo;__save(this), so patch is possible
        },
        
        __get_updatedHandler: function($this, autoSubmit){
            return function(event){
                
                var domElement = $(event.target);
                var currentContent = $this.__onGet(false);
                var newContent = domElement.val();
                
                if (currentContent != newContent) {
                    $this.__update(newContent);
                    
                    if (autoSubmit)
                        $this.__save();
                }           
    
                return true
            }
        },
        
        __updateConnected: function(content){            
            for (var element in this.__domElements) {
                this.__domElements[element].val(content).change()
            };
        },
        
        __connect: function(domElement, callback, autoSubmit){
            domElement = $(domElement);
            this.__domElements.push(domElement);
            
            domElement.change(this.__get_updatedHandler(this, autoSubmit)); // on('change.introspective-api-object.' + this.__parent.__getID(), 
            
            if (this.__parent.__isCreated()) {
                this.__load(function(result){
                    domElement.val(result.getContent()).change();
                    if (callback instanceof Function) {
                        callback(result);
                    }   
                })
            }else{
                if (callback instanceof Function) {
                    callback(result);
                }
            }

        },
        
        __disconnect: function(domElement){
            for (var element in this.__domElements) {
                if (this.__domElements[element] == domElement) {
                    delete this.__domElements[element];
                }
            }
            domElement.val(null);     
            domElement.off('.introspective-api-object.' + this.__parent.__getID());
            
        },
        
        __asForm: function(){
            ret = $('<input type="text">');
            this.__connect(ret, function(){}, true);
            return ret           
        }
        
    });
    
    function LinkedResource() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(LinkedResource.prototype, ApiObject.prototype);
    
    
    function ApiPlaceholder() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiPlaceholder.prototype, ApiObject.prototype);
    $.extend(ApiPlaceholder.prototype, {
        __isBlank: function(apiClient, parent, target, data){
            return true
        },
    })
    
    function LinkedRelationship() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(LinkedRelationship.prototype, LinkedResource.prototype);
    $.extend(LinkedRelationship.prototype, {
        __init: function(settings){
            this.__tempIDs = 0;
            settings.initialContent = settings.initialContent || [];
            LinkedResource.prototype.__init.apply(this, arguments);
            this.__lookupList = {};
            // after syncContent might have been initialized with original array,
            // hack the array
            this.__initArray(settings.initialContent);
        },
        
        __initArray: function(arr){
            var $this = this;
            /*
            var ArrayMixin = function(){};
            $.extend(ArrayMixin.prototype, arr.constructor.prototype);
            Object.defineProperty(ArrayMixin, 'length', {get: function() {
                return 0;
             }});
            arr.prototype = new ArrayMixin();*/
            /*
            arr.prototype = new Array();
            arr.prototype.totalLength = (function(getter)
            {
                return function()
                {
                    return getter();
                }
            })(function(){ // mockup
                return 0
            });
            
            arr.prototype.totalLength.valueOf = (function(own_length_method)
            {
                return function()
                {
                    return own_length_method();//call the length method
                }
            })(arr.prototype.totalLength);*/
            this.__bind('post-load', function(event, result){
                arr.totalLength = $this.__length();
            })
            this.__bind('post-add', function(event, obj){
                arr.totalLength += 1;
            });
            this.__bind('post-remove', function(event, obj){
                arr.totalLength -= 1;
            });
            arr.totalLength = $this.__length();
            //this.__inspect();
        },
        
        __length: function(){
            return 0//this.__content.json.length // TODO: check in response for x-records range header
        },
        
        __checkContent: function(_target){
            _target = _target !== undefined ? parseInt(_target) : undefined;
            for (var target in this.__content['json']) {
                var origTarget = target;
                target = parseInt(target);
                if (_target && _target !== target) {
                    continue
                }
                if (isNaN(target)) {
                    continue
                };
                
                if (JSON.stringify(this.__syncedContent['json'][target]) !== JSON.stringify(this.__content['json'][target])) {
                    if (this.__content['json'][target] && this.__content['json'][target].length && this.__content['json'][target][0] == '!') {
                        continue // dont update temporary entries
                    }
                    this.__update(target, this.__content['json'][target]);
                }
            }
            if (this.__uncommitted.length === 0 && this.__syncedContent['json'].length == this.__content['json'].length) {
                return
            }
            for (var target in this.__syncedContent['json']) {
                if (_target && _target !== target) {
                    continue
                }
                if (!this.__content['json'].hasOwnProperty(target) && !this.__uncommitted.hasOwnProperty(target)) {
                    this.__update(target, null);
                }
            }
        },
        
        __updateArray: function(index, resource, uncommitted, replace){
            if (!resource) {
                _log(this.__log, 'debug', ['not updating array element index', index]);
                return false
            }
            var isObj = resource.__getID !== undefined;
            var resourceID = (isObj ? resource.__getID() : resource) || ('!' + this.__tempIDs++); 
            var commit = true;
            replace = replace === undefined ? true : replace;  // replace makes this list a set
            uncommitted = uncommitted === undefined ? true : uncommitted;
            
            if (index === undefined) {
                if (replace && this.__lookupList.hasOwnProperty(resource)) {
                    index = this.__lookupList[resource];
                    var oldID = this.__content['json'][index];
                    if (oldID != resourceID) {
                        delete this.__objects[oldID];
                    }
                }else{
                    //TODO: get index for this sorting
                    index = -1;
                }
            }
            if (index === null) {
                //TODO: put at first position don't get any sorting position
                index = -1;
                commit = false;
            }
            if (replace && this.__content['json'].indexOf(resourceID) != -1) {
                var oldIndex = this.__content['json'].indexOf(resourceID);
                index = index == -1 ? oldIndex : index;
                if (index != oldIndex) {
                    // TODO: remove old index
                }
            }
            _log(this.__log, 'debug', ['updating array element', resource, 'for index', index]);
            var listContent = isObj ? resourceID : resource; // TODO: make sure this is the relationship content and not the related objects
            
            if (index === -1) { // todo
                index = (this.__content['json'].push(resourceID)) -1 ;
            }else{
                this.__content['json'][index] = resourceID;
            }
            this.__lookupList[resource] = index
            if (isObj) {       
             // todo: uuid => global storage as in __get as well
                this.__objects[resourceID] = resource;
            }
            
            if (commit && (uncommitted || !this.__uncommitted.hasOwnProperty(resourceID))) {
                var current_index = this.__syncedContent['json'].indexOf(resourceID) != -1 ? this.__syncedContent['json'].indexOf(resourceID) : null;
                if (current_index == index) {
                    if (this.__uncommitted.hasOwnProperty(resourceID)) {
                        delete this.__uncommitted[resourceID];
                    };
                }else{
                    this.__uncommitted[resourceID] = index;
                }
                
                this.__trigger('changed', [index, resource])
            }
            //this.__trigger('changed', [resource]);
            //this.__trigger('list-added', [resource]);
        },
        
        __all: function(targetOrSettings, _data){
            return this.__get(targetOrSettings, _data, true)
        },
        
        __add: function(obj, uncommitted){
            var isCreated = obj ? obj.isCreated() : false,
                $this = this;
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(add)', 'adding', obj, 'to', this])
            this.__update(isCreated ? undefined : null, obj, uncommitted);
            if (!isCreated) {
                obj.bind('post-create', function(event, result){
                    $this.__update(undefined, obj, uncommitted);
                    $this.__trigger('post-add', [obj]);
                })
            }else{
                this.__trigger('post-add', [obj]);
            }
        },
        
        add: function(){
            return this.__add.apply(this, arguments)
        },

        all: function(){
            return this.__all.apply(this, arguments)
        },
    })
    
    
    
    return ApiObject;
});