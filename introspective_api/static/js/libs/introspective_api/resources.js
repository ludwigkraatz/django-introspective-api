define(['jquery', 'introspective-api-log', 'introspective-api-utils', 'json'], function ($, _log, apiUtils, JSON) {
    var resources,
        ApiEvent = apiUtils.ApiEvent,
        ApiResult = apiUtils.ApiResult,
        Path = apiUtils.ApiPath,
        LINK_HEADER_TARGETS = apiUtils.LINK_HEADER_TARGETS,
        unpackURL = apiUtils.unpackURL,
        parseLinkHeader = apiUtils.parseLinkHeader,
        parseLinkTemplateHeader = apiUtils.parseLinkTemplateHeader,
        isEmpty = apiUtils.isEmpty;
    
    // event.subEvent
    // => every time an subEvent is called, the event is called some time afterwards (it may take several subevents until event is called)
    var apiObjectEvents = {
        
        // callback(event, apiResult)
        'initialized': {},
        'post-save': {},
        'failed-save': {},
        //'post-save-related': {},
        'post-add': {},
        'failed-add': {},
        'post-create': {},
        'failed-create': {},
        'failed-load': {},
        'post-load': {
            'post-refresh': {}
        },
        'post-discover': {},
        'failed-discover': {},
        'post-delete': {},
        'failed-delete': {},
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
        'accessed-new': {},
        'accessed-related': {},
        'accessed-attribute': {},
        'accessed-unknown': {},
        'accessed-clone': {}
    }
        
        
    function ApiObject() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiObject.prototype, apiUtils.EventMixin, {   
        
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
                url = settings.url,
                uri = settings.uri,
                info = settings.info;
            
            this.setLog(settings.log || null);
            this.__is_blank = settings.isBlank || false;
            this.__initEventMixin(apiObjectEvents);
            this.__reset_obj(initialContent);
            
            this.__info.id_attrs = ['uuid', 'pk', 'id']
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
                if (uri) {
                    this.__updateURILinks({'.': uri});
                }
            }
            if (info) {
                $.extend(this.__info, info)
            }

        },
        
        __updateURILinks: function(links){
            var $this = this;
            function addLink(link, url) {
                url = unpackURL(url, data, this);
                $this.__URIlinks[link] = url;
                if ($this.__links[link] === undefined) {
                    $this.__links[link] = url;
                }
            }
            
            if (links) {
                $.each(links, function(index, entry){
                    addLink(index, entry);
                })
                return 
            }

            var data = {}
            for (var entry in $this.__content['json']) {
                data[entry] = $this.__content['json'][entry];
            } // todo: really??
            // todo also include objects - data[object_name] = object.data??
            
            
            if ($this.__apiClient.sitemap) {
                if (this.__path) {
                    var URIs = this.__path.getURIs($this.__apiClient.getSitemap());
                    for (var link in URIs){
                        addLink(link, URIs[link]);
                    }
                }
                
            }else{
                _log(this.__log, 'warning', ['(IntrospectiveApi)', '(Object)', '(updateURILinks)', 'sitemap not loaded yet - so not updating uris'])
                // api client not initialized yet. and
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
            if (target === undefined) {
                target = ((this.__URLlinks['self'] && !$.isEmptyObject(data) && this.__isCreated()) || (data && data['.'])) ? 'self' : null
            }
            
            if (target == 'self' && (data && data['.'])) {
                return data['.'] // TODO: as url
            }
            
            if (target && this.__URLlinks[target]) {
                return unpackURL(this.__URLlinks[target], data, this)
            }
            if (LINK_HEADER_TARGETS.indexOf(target) != -1 && data && data[target] && this.__URLlinks[data[target]]) {
                return this.__URLlinks[data[target]]
            }
            
            var links = this.__URLlinks;
            var url = '';
        
            if (links['.']) {
                url = links['.'];
                if (url === undefined) {
                    throw Error('this one is not accessible')
                }
                if (url.indexOf('{') != -1) {
                    url = unpackURL(url, data, this)
                    //throw Error('provided data  does not match')
                }
                return url
            }else{
                //?
            }
            
            return null;
        },
        
        __asURI: function(target, data){
            if (target === undefined) {
                target = ((this.__URIlinks['self'] && !$.isEmptyObject(data) && this.__isCreated()) || (data && data['.'])) ? 'self' : null
            }
            
            if (target == 'self' && (data && data['.'])) {
                return data['.'] // TODO: as uri
            }

            if (target && this.__URIlinks[target]) {
                if (data && LINK_HEADER_TARGETS.indexOf(target) != -1 && data[target]) {
                    return unpackURL(this.__URIlinks[target], data, this)
                }
                return this.__URIlinks[target]
            }
            
            if (data && LINK_HEADER_TARGETS.indexOf(target) != -1 && data[target] && this.__URIlinks[data[target]]) {
                return this.__URIlinks[data[target]]
            }
            
            var links = this.__URIlinks;
            var url = '';
        
            if (links['.']) {
                url = links['.'];
                //if (url === undefined) {
                //    throw Error('this one is not accessible')
                //}
                if (url.indexOf('{') != -1) {
                    url = undefined
                }
                if (url) {
                    return url
                }
            }
            
            if (!this.__path) {
                return undefined
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
            var result = new ApiResult({resource: this, raw: raw, action: action});
            result.registerSettings(settings);
            return result
        },
        
        __isCreated: function(){// todo
            return this.__sync.length > 0 && !$.isEmptyObject(this.__syncedContent.json);
        },
        
        __isBlank: function(){// todo
            return this.__is_blank;
        },
        
        __updatePath: function(target, data, url){
            if (data) {
                if (!this.__data) {
                    this.__data = {}
                }
                $.each(this.__info.id_attrs, function(index, attr){
                    if (attr && data[attr]) {
                        this.__data[attr] = data[attr];
                    }
                }.bind(this))
                if (target && data[target]) {
                    this.__data[target] = data[target];
                }
                
            }
            this.__path = new Path(this.__path, target, this.__data);
            //this.__links = {};
            this.__updateURILinks();
            var new_url = url || this.__asURL(target, this.__data);
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
            var new_instance = new ApiResource({
                apiClient:this.__apiClient,
                data:null,
                target:null,
                initialContent:settings.initialContent,
                log:log,
                info: $.extend({}, this.__info, {is_resource: true, is_list: false}),
                url: this.__asURL() || this.__asURI()
            });
            
            new_instance.__initialized = true;
            new_instance.__trigger('initialized', [])
            new_instance.__bind('post-create', function(event, result){
                if (result.wasSuccessfull) {
                    new_instance.__updatePath(target, result.getResource().__syncedContent['json']);
                }
            })
            this.__trigger('accessed-new', [new_instance])
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', 'accessed new', new_instance, 'from', this])
            return new_instance
        },
        __create: function(data, callback){ // TODO: update path as well here?
            var $this = this;
            obj = new ApiResource({apiClient:this.__apiClient, parent:this, target:null, data:data, asClone:true, initialContent:data, log: this.__log});
            request = {
                data: data,
                type: 'post',
                isApiInternal: true,
                
            }
            var result = obj.__asResult('create', {data:data, callback:callback});
            request.done = function(_result){
                result.registerResult(_result);
                obj.__updateFromResponse(_result.getResponse(), result);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('post-create', [result]);
                $this.__finishedLoading(result);
            }
            request.fail = function(_result){
                result.registerResult(_result);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('failed-create', [result]);
                $this.__finishedLoading(result);
            }
            
            this.__setURL(request);
            var requestSettings = {log: this.__log};
            this.__startLoading(result);
            var ajaxID = this.__apiClient.add(request, requestSettings);            
            obj.__sync.push(ajaxID);
            result.registerRequest(ajaxID, request, requestSettings);
            return obj
        },
        
        __execute: function(action, data, callback){ // executes an action on resource
            if (typeof action == 'object' && data === callback === undefined) {
                data = action.data;
                callback = action.callback;
                action = action.action;
            }
            var $this = this;
            var result = this.__asResult('execute', {action:action, data:data, callback:callback}),
                request = {type:'post'};
            request.done = function(_result){
                result.registerResult(_result); 
                //obj.__updateFromResponse(response, result);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('post-execute', [result]);
                $this.__finishedLoading(result);
            }
            request.fail = function(_result){
                result.registerResult(_result);
                if (callback instanceof Function) {
                    callback(result);
                }
                $this.__trigger('failed-execute', [result]);
                $this.__finishedLoading(result);
            }
            
            this.__setURL(request, {action: action, data: data});
            var requestSettings = {log: this.__log};
            this.__startLoading(result);
            var ajaxID = this.__apiClient.add(request, requestSettings);
            result.registerRequest(ajaxID, request, requestSettings);
            return result
        },
        
        __setURL: function(request, target_or_action){
            var data = {},
                target,
                action_meta,
                action;
            if (typeof target_or_action == 'object') {
                action = target_or_action;
                action_meta = this.__discovered.getResponse().actions[action['action']];
            }else{
                target = target_or_action;
            }

            if (request.data instanceof FormData) {
                if (this.__unresolvedData) {
                    $.each(this.__unresolvedData, function(name, content){
                        request.data.append(name, content);
                    })
                }
            }else{
                if (action === undefined) {
                    $.extend(data, this.__unresolvedData);
                    if (request.data) {
                        $.extend(data, request.data);
                    }
                }else{
                    data = action['data'];
                    if (data === undefined) {
                        data = {};
                        for (var attr in action_meta) {
                            data[attr] = this.__content['json'][attr];
                            if (action_meta[attr].required && data[attr] === undefined) {
                                _log(this.__log, 'error', ['missing attribute "' + attr + '" in order to execute "' + action['action'] + '"', this])
                                throw Error('cannot execute "' + action['action'] + '"')
                            }
                        }
                    }
                }
                request.data = data;
            }
            
            
            
            var url = this.__asURL(target, data);
            if (url) {
                if (action !== undefined) {
                    url = this.__apiClient.__setSpecialQueryParam(url, 'action', action['action']);
                }
                request.url = url
            }else{
                var uri = this.__asURI(target, data);
                if (uri) {
                    if (action !== undefined) {
                        uri = this.__apiClient.__setSpecialQueryParam(uri, 'action', action['action']);
                    }
                    request.uri = uri;
                }else{
                    throw Error('has neither uri nor url');
                }
            }
        },
        
        __checkContent: function(_target){
            
            if (this.__content['json'].constructor === Array && this.__info.is_resource) {
                // TODO - what should be done in case the resource is an array
                if (JSON.stringify(this.__syncedContent['json']) !== JSON.stringify(this.__content['json'])) {
                    //this.__updateContent(this.__content['json'], 'json', true);
                    this.__uncommitted['.'] = this.__content['json']
                }
            }else{
                for (var target in this.__content['json']) {
                    if (_target && _target !== target) {
                        continue
                    }
                    if (JSON.stringify(this.__syncedContent['json'][target]) !== JSON.stringify(this.__content['json'][target])) {
                        this.__update(target, this.__content['json'][target]);
                    }
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
        
        
        __save: function(callback_or_settings){    
            var $this = this;            
            var apiClient = $this.__apiClient;
            var todo = 1; // starting at 1!!
            var sync_obj;
            var settings = typeof(callback_or_settings) == 'function' ? {callback: callback_or_settings}: callback_or_settings || {},
                isCreated = this.__isCreated();
            var asFormData = settings.asFormData;
            
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
                    $this.__trigger((childrenResult.wasSuccessfull ? 'post' : 'failed') + '-save', [result]);
                }else{
                    $this.__trigger((childrenResult.wasSuccessfull ? 'post' : 'failed') + '-create', [result]);
                }
            }
        
            if ($this["saving"] == true) {
                throw Error('already saving, wait');
                //$this.__abort($this.__committing[target])
            }
            this.__checkContent()
            var data = {};
            var seperateRequest = [];
            var saveObject = !isCreated,
                values = [];
            for (var target in $this.__uncommitted) {
                //if (!$this.__syncedContent['json'].hasOwnProperty(target)) { //  
                    //if (!$this.__objects[target].__isCreated()) {
                    //    seperateRequest.push(target);
                    //};
                if ($this.__objects[target] && !($this.__objects[target] instanceof ResourceAttribute) && !(this instanceof ApiList)) {
                    if ($this.__objects[target].needsSave()){
                        $this.__objects[target].save();
                    }
                }else if (target == '.'){
                    data = $this.__uncommitted[target];
                    saveObject = true;
                    values.push(target);
                }else {
                    data[target] = $this.__uncommitted[target];
                    saveObject = true;
                    values.push(target);
                }
                if (!asFormData && $this.__objects[target] && ($this.__objects[target] instanceof ResourceAttribute) && $this.__objects[target].requiresFormData()) {
                    asFormData = true;
                }
                
                $this.__committing[target] = $this.__uncommitted[target];
                delete $this.__uncommitted[target];
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(save)', 'committing', values, this.__uncommitted])
            
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
                return function(_result){
                    result.registerResult(_result);
                    $this.__updateFromResponse(_result.getResponse(), result);
                    
                    for (var target in data) {
                        delete $this.__committing[target];
                    }
                    finishedOne(result);
                    $this.__finishedLoading(result);
                }
            }
            
            function failedSaving(result, data){
                return function(_result){
                    result.registerResult(_result);
                    
                    for (var target in data) {
                        if ($this.__uncommitted[target] === undefined){
                            $this.__uncommitted[target] = data[target];
                        };
                        delete $this.__committing[target];
                    }
                    finishedOne(result);
                    $this.__finishedLoading(result);
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
                    //data: JSON.stringify(data),
                    //contentType: 'application/json; charset=utf-8',
                    //processData: false,
                    //dataType: 'json',
                    done: finishedSaving(result, data),
                    fail: failedSaving(result, data),                    
                    isApiInternal: true,
                };
                if (asFormData) {
                    var formData = new FormData();
                    var attributes = this.getAttributes();
                    $.each(data, function(name, val){
                        var attr = attributes[name];
                        if (!attr || !attr.requiresFormData()) {
                            formData.append(name, val);
                        }else{
                            var file = attr.getFormData();
                            formData.append(name, file);
                        }
                        
                    });
                    request.data = formData;
                    request.processData = false;
                    request.contentType = false;
                    request.signPayload = false; 
                }else{
                    request.data = data;
                }
                
                $this.__setURL(request);
                var requestSettings = {log: this.__log};
                sync_obj = apiClient.add_urgent(request, requestSettings)
                result.registerRequest(sync_obj, request, requestSettings);
                
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
        
        __asIdentifier: function(){
            return this.__getID() || this.__asURL() + '!';  // TODO
        },
        
        __getID: function(data){
            if (data === undefined) {
                data = this.__data
                if (!data || $.isEmptyObject(data)) {
                    data = this.__content['json']
                }
            }
            if (typeof data == 'string' || typeof data == 'integer') {
                return data
            }
            if (!data) {
                return undefined
            }
            if (typeof data == 'object' && typeof(data.__getID) == 'function') {
                return data.__getID()
            }
            for (var index in this.__info.id_attrs){
                var attr_name = this.__info.id_attrs[index];
                if (data[attr_name]) {
                    return data[attr_name]
                }
            }
            return undefined
        },
        
        __parseTarget: function(target, data){
            var args = "";
            if ((this.__links[target] !== undefined) &&
                      (data instanceof Object)) {
                // this matches links like target='with_date', data={with_date:20.1.2001} with with_date:/api/by_date/?date={with_date}
                args += data[target];
            }else if ((LINK_HEADER_TARGETS.indexOf(target)>=0)
                    && (data instanceof Object)
                    && (this.__links[data[target]] !== undefined)) {
                // this matches target='link', data={link: primary}, with primary: /api/somewhere/?primary
                args += data[target]
            }else if ((LINK_HEADER_TARGETS.indexOf(target)>=0) && (this.__links[data])) {
                // this matches target='link', data='primary', with primary: /api/somewhere/?primary
                args += data
            }else if ((LINK_HEADER_TARGETS.indexOf(target)>=0) && (data instanceof Object)) {
                for (var index in data) {
                    args += index + ':' + data[index] + ';'
                }
            }
            if (args) {
                return target + '|' + args
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
                target = LINK_HEADER_TARGETS.indexOf(settings.target) == -1 ? settings.target : settings.data[settings.target],
                as_attr = false,
                accessType;
            if (target == 'attr') {
                as_attr = true;
                target = settings.data[target];
            }

            if (old && !old.__isBlank()) {
                return old
            }
            if (old === undefined || old.__isBlank()) {
                 if (as_attr || ($this.__getAttributes(false)[target] || $this.__content[target] != undefined) && (!settings.data || $.isEmptyObject(settings.data))) {
                    _settings.data = this.__getAttributes(false)[target];
                    var attribute = new ResourceAttribute(_settings);
                    attribute.__updateContent(this.__content['json'][target]);
                    obj = attribute;
                    accessType = "attribute";
                }else if ($this.__links[_settings.target] != undefined || $this.__links[target] != undefined || _settings.target == 'relationship' ){
                    // TODO: only if were on object endpoint!! LINK_HEADER_TARGETS.indexOf(settings.target) != -1){

                    var resource;
                    _settings.url = this.__asURL(_settings.target, _settings.data);
                    if (!_settings.url) {
                        _settings.uri = this.__asURI(_settings.target, _settings.data);
                    }
                    
                    if (settings.target == 'relationship') {
                        resource = new ApiList(_settings);
                        var relationship = _settings.data;
                        if (relationship instanceof Object) {
                            relationship = _settings.data.relationship
                        }
                        $this.__setObj(relationship, resource);
                    }else{
                        // we don't know yet whether it is a resource or resourceListr
                        resource = new ApiObject(_settings);
                    }
                    obj = resource;
                    accessType = "related";
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
                                $this.__resolveObj(targetID, settings);
                                // replacement is done when resolving
                            })
                            $this.discover({});
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
                                var __settings = $this.__unevaluatedObjectsObject[targetID];
                                delete $this.__unevaluatedObjects[targetID];
                                targetID = $this.__parseTarget(__settings.target, __settings.data)
                                $this.__resolveObj(targetID, __settings);
                            }
                        }); // TODO: force: true
                    } else{
                        // todo: do this another time
                        //delete $this.__unevaluatedObjects[targetID];
                    }
                }
                if (!obj.__isBlank()) {
                    this.__setObj(targetID, obj);
                }else{
                    obj.bind('initialized', function(){
                        $this.__setObj(targetID, obj);
                    })
                }
                this.__trigger('accessed-' + accessType, [obj])
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(resolveObject)', 'resolving', targetID, 'and', settings, 'from', this, 'to', obj, '(links: ', $.extend({}, this.__links),')'])
            return obj;
        },

        __setObj: function(target, obj){
             // todo: uuid => global storage as in __get as well
            var $this = this;
            this.__objects[target] = obj;
            obj.__bind('replaced', function(event, newObj){
                if ($this.__objects[target] === obj) {
                    $this.__objects[target] = newObj;
                }
            })
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
            if (target === undefined && !$.isEmptyObject(data)) {
                for (var key in data) {
                    if (this.__links[key]) {
                        target = key;
                        break
                    }
                }
                if (!target) {
                    for (var index in this.__info.id_attrs){
                        var attr_name = this.__info.id_attrs[index];
                        if (data[attr_name]) {
                            target = attr_name;
                            break
                        }
                    }
                }
                if (!target) {
                    _log(log, 'error', ['(introspectiveApiClient)', '(ApiObject)', 'could parse target.', target, data, this]);
                    throw Error('could not parse target')
                }
            }
            //if (!target) {
            //    log.error('(introspectiveApiClient)', '(ApiObject)', 'could parse target.', target, data, this);
            //    throw Error('could not parse target')
            //}
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
            
            if (target) {
                //var wasCreated = undefined;
                obj = this.__resolveObj(targetID, settings)
                
                if (obj != undefined) {
                    var state = {
                        "status": "found",
                        "timestamp": +new Date()/1000,
                    };
                    if (this.isBlank()) {
                        this.__bind('replaced', function(event, newParent){
                            obj.replaceWith(newParent.__get(targetOrSettings, _data, wrapped))
                        })
                    }
                    
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
                var clone_config = {
                    apiClient:this.__apiClient,
                    parent:this,
                    target:null,
                    data:data,
                    asClone:true,
                    initialContent: content,
                    log:log,
                    info: this.__info
                },
                    clone = new this.constructor(clone_config);
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
            
            function finishTarget(targetResult) {
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
                        result.getResource().prepare(targetSettings.depending, function(dependingResult){
                                                                    result.appendResult(dependingResult);
                                                                    finishTarget(result);});
                    }else{
                        finishTarget(result);
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
                callbacks.done = function(_result){
                    result.registerResult(_result);
                    $this.__updateFromResponse(_result.getResponse, result);
                    if (settings.callback)settings.callback(result);
                }
                callbacks.fail = function(_result){
                    result.registerResult(_result);
                    if (settings.callback)settings.callback(result);
                }
                
                this.__apiClient.registerCallbacksForRequest(this.__discovering, callbacks);
                
            }else if (this.__discovered && (settings.forceReload === undefined || settings.forceReload === false)) {
                //var result = this.__asResult('discover', settings);
                result.wasCached($this.__discovered);
                if (settings.callback)settings.callback(result);
            }else{
            
                $this.__startLoading(result);
                var request = {
                    type: 'options',
                    done: function (_result) {
                        $this.__discovering = undefined;
                        result.registerResult(_result);  
                        //$this.__discovered = _result;^
                        $this.__updateFromResponse(_result.getResponse(), result);
                        if (settings.callback instanceof Function) {
                            settings.callback(result); 
                        }
                        $this.__trigger('post-discover', [result]);                         
                        $this.__finishedLoading(result);
                
                    },
                    fail: function (_result) {                
                        result.registerResult(_result);
                        if (settings.callback instanceof Function) {
                            settings.callback(result);      
                        }  
                        $this.__trigger('failed-discover', [result]);
                        $this.__finishedLoading(result);
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
                result.registerRequest(ajaxID, request, requestSettings);
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
            }
            if (settings.force) {
                // TODO: deprication warning
                settings.forceReload = settings.force;
            }
            
            if (this.__initializing != undefined) {
                var result = this.__asResult('load', settings);
                var callbacks = {};
                callbacks.done = function(_result){
                    result.registerResult(_result);
                    if (settings.callback)settings.callback(result);
                }
                callbacks.fail = function(_result){
                    result.registerResult(_result);
                    if (settings.callback)settings.callback(result);
                }
                
                // TODO: it can happen that the id is completed, the time this method executes! (had this case)
                if (this.__apiClient.registerCallbacksForRequest(this.__initializing, callbacks))
                    return this;
                
                if (this.__initializing) {
                    _log(this.__log, 'error', ['(introspectiveApi)', '(Object)', 'still initializing but not able to register callbacks'])
                }
                
            }
            
            if (!settings.format && (this.__initialized || !$.isEmptyObject(this.__syncedContent['json']))&& (settings.forceReload === undefined || settings.forceReload === false)) {
                var result = this.__asResult('load', settings);
                result.wasCached();
                if (settings.callback) settings.callback(result);
                $this.__trigger('post-load-from-cache', [result]);
            }else{
                settings.returnResult = true;
                result = this.__refresh(settings);
                var callbacks = {};
                callbacks.done = function(_result){
                    $this.__trigger('post-load', [result, _result]);
                }
                callbacks.fail = function(_result){
                    $this.__trigger('failed-load', [result, _result]);
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
            }
            
            if (settings.loadContent === undefined) {
                settings.loadContent = true;
            }
            if (settings.force) {
                // TODO: deprication warning
                settings.forceReload = settings.force;
            }
            
            var result = this.__asResult('refresh', settings);
            
            
            $this.__startLoading(result);
            var request = {
                type: settings.loadContent ? 'get' : 'head',
                done: function (_result) {          
                    result.registerResult(_result);    
                    $this = $this.__updateFromResponse(_result.getResponse(), result, settings); 
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }   
                    $this.__trigger('post-refresh', [result]);
                    $this.__finishedLoading(result);  
            
                },
                fail: function (_result) {
                    result.registerResult(_result);
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }
                    $this.__trigger('failed-refresh', [result]);
                    $this.__finishedLoading(result);
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
            result.registerRequest(ajaxID, request, requestSettings);
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
                done: function (_result) {
                    result.registerResult(_result);
                    $this = $this.__updateFromResponse(_result.getResponse(), result, settings); 
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }   
                    $this.__trigger('post-delete', [result]);
                    $this.__reset_obj();                             
                    $this.__finishedLoading(result);
                },
                fail: function (_result) {
                    result.registerResult(_result);
                    if (settings.callback instanceof Function) {
                        settings.callback(result);      
                    }
                    $this.__trigger('failed-delete', [result]);                
                    $this.__finishedLoading(result);
                },
                isApiInternal: true
            };
            $this.__setURL(request);
            var requestSettings = {log: settings.log || this.__log};
            var ajaxID = $this.__apiClient.add(request, requestSettings);
            $this.__sync.push(ajaxID);
            result.registerRequest(ajaxID, request, requestSettings);
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
                    if (this.__content[format].constructor === Array && this.__info.is_resource) {
                        if (!content) {
                            this.__update(content, uncommitted)
                        }
                        if (!uncommitted) { // do it again for synced content TODO: really?
                            this.__syncedContent[format] = [];
                        }
                    }else{
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
            }
            if (dataType.indexOf('json') != -1) {
                if (content instanceof Array) {
                    if (this.__info.is_resource) {
                        this.__content['json'] = content;
                    }else{
                        for (var entry in content) {
                            // todo: first check storage for cached instance
                            var _settings = {apiClient: this.__apiClient, parent: this, target: undefined, data: content[entry], asClone:true, log:log};
                            
                            _settings.url = this.__asURL(_settings.target, _settings.data);
                            if (!_settings.url) {
                                _settings.uri = this.__asURI(_settings.target, _settings.data);
                            }
                            var obj = new ApiObject(_settings);
                            obj.__updateContent(content[entry], dataType, uncommitted, settings);
                            obj.__initialized = true;
                            obj.__initializing = undefined;
                            obj.__trigger('initialized', []);
                            var id = obj.__getID();
                            if (id) {
                                // TODO: because introspective api requires UUID, maybe rather use a global __objects storage
                                if (result)obj.__sync.push(result.ajaxID);
                                this.__setObj(id, obj);
                            }
                        }
                        //$.extend(this.__content['json'], content);
                        //_log(this.__log, 'debug', ['(introspectiveApi)', '(Object)', 'updating array', this, 'with', content, 'to', $.extend(this.__content['json'], content)])
                        this.__content['json'] = $.extend(this.__content['json'], content);
                    }
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
                        }else{
                            throw Error('TODO: implement update with format != json')
                        }
                    }
                    for (var entry in this.__objects) {  // TODO: is this needed?
                        if (!content.hasOwnProperty(entry)) {
                            continue
                        }
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
        
        __getAttributes: function(required){
            if (this.__info.attributes) {
                return this.__info.attributes
            }
            if (!required) {
                return {}
            }
            throw Error('TODO: implement resource.getAttributes')
        },

        __update_info: function(result, is_discovery){
            var jqXHR = result.getXhr(),
                $this = this,
                response = is_discovery ? result.getResponse('json') : {};

            if (is_discovery) {
                this.__discovered = result;
            }
    
            if (result.getRequest().type.toLowerCase() == 'post') {
                var location = jqXHR.getResponseHeader('Location');
                if (location){
                    additionalLinks['.'] = location;
                }
            }else if (jqXHR.url) {
                additionalLinks['.'] = jqXHR.url;
            }

            _log(result.log || this.__log, 'debug', ['(IntrospectiveApi)', '(ApiObject)', '(updateFromResponse)', 'link header', this, result, jqXHR.getResponseHeader('Link'), jqXHR.getResponseHeader('Link-Template')])
            $.extend(additionalLinks, parseLinkHeader(jqXHR.getResponseHeader('Link')));
            $.extend(additionalLinks, parseLinkTemplateHeader(jqXHR.getResponseHeader('Link-Template')));
            this.__updateURLLinks(additionalLinks);

            if (jqXHR) {
                var ranges = jqXHR.getResponseHeader('Accept-Ranges');
                if (!ranges) {
                    ranges = response['Accept-Ranges']
                }
                var viewType = jqXHR.getResponseHeader('X-ViewType');
                this.__info.ranges = ranges;
                // TODO: this is not good so far..
                this.__info.is_list = (ranges ? ranges.indexOf('x-records') != -1 && this.isCreated() : false) || (viewType && viewType == 'List');
                this.__info.is_resource = !this.__info.is_list;
            }
            if (response['attributes']) {
                this.__info.attributes = response['attributes'];
            }
            if (response['pk_names']) {
                this.__info.id_attrs = response['pk_names'];
            }
            
            if (response['actions'] && (response['actions']['POST'] || response['actions']['PUT'])) {
                this.__info.attributes = response['actions']['POST'] || response['actions']['PUT'];
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
                    replacement = new ApiList(clone_config);
                }else if (this.__info.is_resource) {
                    // TODO: this leads to unacceptable behaviour as it sets this to blank
                    //replacement = new ApiResource(clone_config);
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
            var jqXHR = result.getXhr();
            additionalLinks = {};
            settings = settings || {},
            request = result.getRequest();
            if (!request.type) {
                return _log(settings.log || this.__log, 'warning', ['(IntrospectiveApi)', '(ApiObject)', '(updateFromResponse)', 'result doesnt contain any resquest', result])
            }
            
            this.__update_info(result, request.type.toLowerCase() == 'options');
            // todo:
            /*                
                $this.__onChange(target, state);
                if (settings.onChange) settings.onChange(state);*/
            if (request.type.toLowerCase() == 'post' && !response) {
                // TODO: check "Location" header and get content from there
                _log(settings.log || this.__log, 'error', ['(IntrospectiveApi)', '(ApiObject)', '(TODO)', 'fetch resource from Location Header'])
            }else{
                settings.replace = ['head', 'patch'].indexOf(request.type.toLowerCase()) != -1 ? false : true;
                var data = ['put', 'post', 'patch'].indexOf(request.type.toLowerCase()) != -1 ?
                                response || request.data
                                : response;
                if (request.type.toLowerCase() != 'options'){
                    if (data && (!this.__data || $.isEmptyObject(this.__data))) {
                        if (!this.__data) {
                            this.__data = {};
                        }
                        $.each(this.__info.id_attrs, function(index, name){
                            if (data[name]) {
                                this.__data = data[name];
                            }
                        })
                    }
                    this.__updateContent(data, jqXHR.getResponseHeader('Content-Type'), false, settings, result);
                // replacing/updating __syncedContent
                //$this.__syncContent(data, request.type.toLowerCase() == 'put' ? true : false);
                    this.__checkContent();
                
                    // todo store as AttibuteObjects
                    /*if (isLink) {
                        $.extend($this['objects'], response)
                    }else{
                        $.extend($this['content'], response);
                    }        */     

                    if (!$this.__initialized || $this.__initializing) {
                        $this.__initialized = true;
                        $this.__trigger('initialized', [result])
                        $this.__initializing = undefined;
                    }
                }                      
                
            }     
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
        
        __updateArray: function(value, uncommitted, replace){
            var $this = this;
            if (!this.__info.is_resource) {
                throw Error('handle relationships in ApiList')
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(update)', 'update resource as array', value, uncommitted, replace])
            
            if (!uncommitted) {
                var arr = [];
                for (var index in this.__content['json']) {
                    arr.push(this.__content['json'][index])
                }
                $this.__syncedContent['json'] = arr;
            }
            // TODO: this.__trigger('updated', [value]) or smth
        },
        __updateObject: function(target, value, uncommitted, replace){
            var $this = this,
                str_value = JSON.stringify(value),
                str_content = JSON.stringify($this.__content['json'][target]),
                str_orig = JSON.stringify($this.__syncedContent['json'][target]);
            uncommitted = uncommitted === undefined ? true : uncommitted;
            replace = replace === undefined ? true : replace;
            targetObj = this.__objects[target];
            if (targetObj instanceof ResourceAttribute) {
                targetObj.__update(value);
            }
            if (str_value === str_content === str_orig) {
                return
            }
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(update)', 'update resource as object', value, uncommitted, replace])
            
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
            if (!result.wasSuccessfull) {
                this.__trigger('failed-loading', [result])
            }
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
        
        __getContent: function(format){
            if (format) {
                return this.__content[format]
            }
            return this.__content;
        },
        
        __connect: function(_domElement, callback){ // TODO: if domElement is instance of jQuery: get real element
            var domElement = _domElement instanceof $ ? _domElement : $(_domElement);
            this.__domElements.push(domElement);
            var inputTargets = new Array();
            $.each(domElement.find(':input'), function(index, elem){
                var name = $(elem).attr('name');
                if (name)inputTargets.push(name);
            });
            if ((this.__initialized || this.__data) && this.__isCreated()) {
                this.__prepare(inputTargets, function(result){
                    var $this = result.getResource();
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
                        var $this = result.getResource();
                        $.each($this.__getAttributes(), function(target, config){
                            var input = domElement.find(':input[name="'+target+'"]');
                    
                            if (input.size()) {
                                $this.__get(target).connect(input);
                            }
                        })
                        
                    },
                });
            };
            
            var submitButton = domElement.find(':submit');
            if (submitButton.size()) {
                var $this = this;
                submitButton.click(function(event){ // on('click.introspective-api-object.'+this.__getID()
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    try{
                        $this.__save();
                    }catch (e){
                        _log(this.__log, 'error', ['failed saving', e]);
                        console.error(e.stack)
                    }
                    return false;
                });
            }

        },
        
        __disconnect: function(_domElement){ // TODO: if domElement is instance of jQuery: get real element
            var domElement = _domElement instanceof $ ? _domElement : $(_domElement);
            
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
                // this should rather throw an error, than that:
                //if (this._replaced_with) {
                //    return this._replaced_with.__replaceWith(resource);
                //}
                this.__trigger('replaced', [resource, this]);
                //replaceWith should automatically call the handlers of replaced objects get, load, É with new object.

                this._replaced_with = resource;
            }// todo: if resource === null: blank
            return this
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
        
        getAttributes: function(){
            var attrs = {},
                $this = this;
            $.each(this.__getAttributes.apply(this, arguments), function(name, config){
                attrs[name] = $this.__get(name);
            })
            return attrs
        },
        
        getID: function(){
            return this.__getID.apply(this, arguments)
        },
        
        getUUID: function(){
            return 'TODO_UUID'
        },
        
        reset: function(){
            return this.__reset.apply(this, arguments)
        },
        
        execute: function(){
            return this.__execute.apply(this, arguments)
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
        
        getResource: function(){
            return this
        },
        
        getList: function(){
            return this
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
        
        asIdentifier: function(){
            return this.__asIdentifier.apply(this, arguments)
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

        updateApiClient: function(apiClient){
            if (this.__apiClient == apiClient) {
                return false
            }
            this.__apiClient = apiClient;
            if (this.__initialized) {
                this.refresh({force: true})
            }
        },
        
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
                data = settings.data;
            this.__reset_obj(settings.initialContent);
            this.__apiClient  = apiClient;
            this.__config       = data || {};
            this.__parent     = parent;
            this.__target_name= target;
            this.__path       = new Path(parent.path, target, data);
            this.__initEventMixin(apiObjectEvents)
            //this.__updateURILinks();
        },
        
        getConfig: function(name){
            if (!name) {
                return $.extend({}, this.__config);
            }
            return this.__config[name]
        },

        getLabel: function(){
            return this.getConfig('label') || this.__target_name
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
                
                return this.__content['json']
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
        
        __update: function(newContent, domElement){
            var $this = this;
            if (JSON.stringify(newContent) === JSON.stringify(this.__content['json'])) {
                return
            }
            $this.__updateContent(newContent);
            
            var content = $this.__onGet(false);
            $this.__parent.__update($this.__target_name, content)
            $this.__updateConnected(content, domElement);
        },
        
        requiresFormData: function(){
            return ['file upload'].indexOf(this.getConfig('type')) != -1
        },
        
        __save: function(){
            this.__parent.__save({asFormData: this.requiresFormData()}) // todo;__save(this), so patch is possible
        },
        
        __get_updatedHandler: function($this, autoSubmit){
            return function(event){
                
                var domElement = $(event.target);
                var currentContent = $this.__onGet(false);
                var newContent = domElement.val();
                
                if (currentContent != newContent) {
                    $this.__update(newContent, domElement);
                    
                    if (autoSubmit)
                        $this.__save();
                }           
    
                return true
            }
        },
        
        __updateConnected: function(content, exclude){            
            for (var index in this.__domElements) {
                var element = this.__domElements[index];
                if (!element || (exclude && exclude[0] === element[0])) {
                    continue
                }
                try {
                    $(element).val(content).trigger('change');
                } catch(e) {
                    this.__domElements[index] = null;
                }
                
            };
        },
        
        getFormData: function(){
            //console.log(this, this.__domElements[0][0].files)
            // this.__domElements[0][0].files.
            /*
             *lastModifiedDate: Fri Feb 01 2013 18:06:29 GMT+0100 (CET)
            name: "..."
            size: 1111
            type: "image/jpeg"
            webkitRelativePath: ""
            */
            // TODO: iterate through all domElements and reset after taking the file?
            
            var file = this.__domElements[0][0].files[0];
            if (this.__domElements[0][0].files.length == 0 || !file) {
                console.log(this.__domElements[0], file, this);
                throw Error('no file found')
            }
            return file
        },
        
        __connect: function(_domElement, callback, autoSubmit){ // TODO: if domElement is instance of jQuery: get real element
            var domElement = _domElement instanceof $ ? _domElement : $(_domElement);
            if (!domElement.attr('id')) {
                domElement.attr('id', this.asDomId());
            }
            
            this.__domElements.push(domElement);
            if (this.__config && this.__config.required) {
                domElement.attr('required', 'required');
            }
            if (this.__config && this.__config.read_only) {
                domElement.attr('disabled', 'disabled');
                if (!this.__parent.__isCreated()) {
                    domElement.hide();
                }
            }
            domElement.change(this.__get_updatedHandler(this, autoSubmit, domElement)); // on('change.introspective-api-object.' + this.__parent.__getID(), 
            
            if (this.__parent.__isCreated()) {
                this.__load(function(result){
                    domElement.val(this.__onGet(false)).change();
                    if (callback instanceof Function) {
                        callback(result);
                    }   
                }.bind(this))
            }else{
                if (callback instanceof Function) {
                    callback(result);
                }
            }

        },
        
        __disconnect: function(domElement){ // TODO: if domElement is instance of jQuery: get real element
            for (var element in this.__domElements) {
                if (this.__domElements[element] == domElement) {
                    delete this.__domElements[element];
                }
            }
            $(domElement).val(null).off('.introspective-api-object.' + this.__parent.__getID());
            
        },
        
        __asForm: function(connect, placeholder, autosubmit){
            var ret,
                type = this.getConfig('type') || 'string';
            if (['string', 'integer'].indexOf(type) != -1 || typeof(type) == 'object'){
                if (this.getConfig('choices') && typeof(this.getConfig('choices')[0]) == 'object') {
                    ret = $('<select></select>');
                    $.each(this.getConfig('choices'), function(index, choice){
                        ret.append('<option value="' + choice[0] + '">' + choice[1] + '</a>')
                    })
                }else{
                    ret = $('<input type="text" />');
                }
                
            }
            if (type == 'password'){
                ret = $('<input type="password" />');
            }
            if (type == 'file upload'){
                ret = $('<input type="file" />');
            }
            if (type == 'date'){
                ret = $('<input type="string" />');
                try {
                    ret.datepicker({dateFormat: 'yy-mm-dd'})
                } catch(e) {
                    
                }
            }
            if (!ret){
                ret = $('<input type="hidden" />');
            }
            ret.attr('name', this.__target_name);
            if (placeholder) {
                ret.attr('placeholder', this.getLabel())
            }
            
            if (connect !== false)this.__connect(ret, function(){}, autosubmit === undefined ? true : autosubmit);
            return ret[0]
        },
        
        asDomId: function(){
            var id = '';
            if (this.__parent && this.__parent.getID()) {
                id += String(this.__parent.getUUID())
            }else{
                id += 'TODO_NEW'
            }
            id += '.' + this.__target_name;
            return id
        }
        
    });
    
    function ApiResource() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiResource.prototype, ApiObject.prototype);
    $.extend(ApiResource.prototype, {
        __update_info: function(){
            ApiObject.prototype.__update_info.apply(this, arguments)
            this.__info.is_resource = true;
            this.__info.is_relationship = false;
        }
    })
    
    
    function ApiPlaceholder() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiPlaceholder.prototype, ApiObject.prototype);
    $.extend(ApiPlaceholder.prototype, {
        __isBlank: function(apiClient, parent, target, data){
            return true
        },
        __init: function(){
            ApiObject.prototype.__init.apply(this, arguments)
            this.__init_args = arguments;
            this.__requested_actions = [];
        },
        __store_request: function(action, args, obj){
            this.__requested_actions.push([action, args, obj])
        },
        load: function(){
            this.__store_request('load', arguments)
        },
        get: function(){
            var obj = new ApiPlaceholder(this.__init_args);
            this.__store_request('get', arguments, obj)
            return obj
        },
        prepare: function(){
            this.__store_request('prepare', arguments)
        },
        refresh: function(){
            this.__store_request('refresh', arguments)
        }
    })
    
    function ApiList() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(ApiList.prototype, ApiResource.prototype);
    $.extend(ApiList.prototype, {
        __init: function(settings){
            this.__tempIDs = 0;
            settings.initialContent = settings.initialContent || [];
            ApiResource.prototype.__init.apply(this, arguments);
            this.__lookupList = {};
            // after syncContent might have been initialized with original array,
            // hack the array
            this.__initArray(settings.initialContent);
        },
        
        __parseTarget: function(target, data){
            if (target == 'self' || this.__info.id_attrs.indexOf(target) != -1) {
                //target = 'x-detail-view';
                var id = this.__getID(data);
                if (id) {
                    return id
                }
            }
            return ApiResource.prototype.__parseTarget.call(this, target, data)
        },
        
        __update_info: function(){
            ApiObject.prototype.__update_info.apply(this, arguments)
            this.__info.is_resource = false;
            this.__info.is_relationship = true;
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
            return this.__content.json.length // TODO: check in response for x-records range header
        },
        
        length: function(){
            return this.__length.apply(this, arguments)
        },
        
        __checkContent: function(_target){
            _target = _target !== undefined ? parseInt(_target) : undefined;
            if (this.__content['json'].constructor === Array && this.__info.is_resource) {
                if (target !== undefined) {
                    throw Error('cant check target content on array resource (yet) "' + target + '"')
                }
                if (JSON.stringify(this.__syncedContent['json']) !== JSON.stringify(this.__content['json'])) {
                    this.__update(this.__content['json']);
                }
            }else{
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
            }
        },
        
        __updateArray: function(index, resource, uncommitted, replace){
            if (!resource) {
                _log(this.__log, 'debug', ['not updating array element index', index]);
                return false
            }
            var isObj = resource.__getID !== undefined;
            var resourceID = this.__getID(resource); 
            var commit = true;
            replace = replace === undefined ? true : replace;  // replace makes this list a set
            uncommitted = uncommitted === undefined ? true : uncommitted;
            
            if (resourceID === undefined) {
                // a new obj is being created
                resourceID = '!' + this.__tempIDs++;
            }
            
            if (index === undefined) {
                if (replace && this.__lookupList.hasOwnProperty(resourceID)) {
                    index = this.__lookupList[resourceID];
                    var oldID = this.__getID(this.__content['json'][index]);
                    if (oldID != resourceID) {
                        delete this.__objects[oldID];
                    }
                }else{
                    //TODO: get index for this sorting from backend or even from resource?
                    index = -1;
                }
            }
            if (index === null) {
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
            this.__lookupList[resourceID] = index
            if (isObj) {       
                this.__setObj(resourceID, resource);
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
        
        __each: function(callback){
            var list = this.__content['json'];
            for (var index in list){
                if (index == 'totalLength') {
                    continue
                }
                var elem = this.__get('self', list[index]);
                if (true) {
                    elem.__discover(callback);
                }else{
                    elem.__load({
                        force: true,
                        callback: callback
                    });
                }
                
            }
        },
        
        __add: function(obj, uncommitted){
            var isCreated = obj ? obj.isCreated() : false,
                $this = this;
            _log(this.__log, 'debug', ['(IntrospectiveApi)', '(Object)', '(add)', 'adding', obj, 'to', this, isCreated ? 'as existing resource' : 'as new resource'])
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

        each: function(){
            return this.__each.apply(this, arguments)
        },
    })
    
    resources = {
        Result: ApiResult,
        Object: ApiObject,
        Placeholder: ApiPlaceholder,
        List: ApiList,
        Attribute: ResourceAttribute,
        Resource: ApiResource
    };
    
    return resources;
});