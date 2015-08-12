define(['jquery', 'json', 'introspective-api-log', ], function($, JSON, _log){
    var utils = {};

    
    utils.LINK_HEADER_TARGETS = ['link', 'relationship'];
    
    function unpackURL(url, data, resource) {
        if (url.indexOf('{') != -1){
            var id_attrs = [];
            if (resource) {
                if ((!data || $.isEmptyObject(data))) {
                    data = {};
                    $.extend(data, resource.__syncedContent, resource.__data);
                }
                
                id_attrs = resource.__info.id_attrs;
            }
            
            if (data['self']) {
                $.each(id_attrs, function(index, name){
                    if (!data[name]) {
                        data[name] = data['self'];
                    }
                })
            }
            for (var substitut in data) {
                if (data[substitut] != undefined) {
                    url = url.replace('{' + substitut + '}', data[substitut]);
                }                    
            }   
        }
        if (url.indexOf('{') != -1){
            console.log(data, resource);
            throw Error('couldnt resolve url template: ' + url)
        }
        return url
    }
    utils.unpackURL = unpackURL;
    function parseLinkHeader(link_header) {
            link_header_expr = /<([a-z:/\-0-9\.?&_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-_?= ]*)",?)*/g
            links = {}
            while (link = link_header_expr.exec(link_header)){
                name = link[3] ? link[3] : link[2];
                links[name] = link[1];
            }
            return links
    };
    utils.parseLinkHeader = parseLinkHeader;
    function parseLinkTemplateHeader(header) {
        templatelink_header_expr = /<([a-z:{}/\-0-9\.?&_=]*)>; rel="([a-zA-Z0-9:/\-?= ]*)"(?:; title="([a-zA-Z0-9:/\-_?= ]*)",?)*/g
        links = {}
        while (link = templatelink_header_expr.exec(header)){
            name = link[3] ? link[3] : link[2];
            links[name] = link[1];
        }
        return links
    };
    utils.parseLinkTemplateHeader = parseLinkTemplateHeader;
    function isEmpty(obj){
        for (var key in obj) {
            return false
        }
        return true
    }
    utils.isEmpty = isEmpty;

    function ApiObjectEvent() {
        this.init.apply(this, arguments)
    }
    utils.ApiObjectEvent = ApiObjectEvent;
    $.extend(ApiObjectEvent.prototype, {
        init: function(name){
            this.name = name;
        }
    })
    
    
    function ApiResult() {
        this.init.apply(this, arguments);
    };
    utils.ApiResult = ApiResult;
    
    $.extend(ApiResult.prototype, {
        
        init: function(settings){
            this.raw = settings.raw || false;
            this.results= [];
            this._Resource = settings.resource;  // TODO: handle Lists (and other types?)
            this.settings= {};
            this.wasSuccessfull= undefined;
            this.request= undefined;
            this.ajaxID= null;
            this.response = undefined;
            this.responseText = undefined;
            this.action = settings.action;
            this.jqXHR = undefined;

            delete settings.action;
            delete settings.raw;
            delete settings.resource;
            this._config = settings;
        },
        
        registerRequest: function(ajaxID, request, settings){
            this.ajaxID = ajaxID;
            if (!this.request && request) {
                this.request = {};
            }
            $.extend(this.request, request);
            if (settings) {
                this.registerSettings(settings);
            }
        },
        
        registerSettings: function(settings){
            $.extend(this.settings, settings);
        },
        
        registerResult: function(result){            
            this.setStatus('', '', result.wasSuccessfull);
            this.results.push(result);
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
        
        wasCached: function(responseText, status, jqxhr){
            if (responseText instanceof ApiResult) {
                jqxhr = responseText.getXhr();
                responseText = responseText.getResponse();
            }
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
        
        getResponse: function(format){
            return this.getContent(format, true);
        },
        
        getContent: function(format, raw){  // TODO format
            if (format === undefined) {
                format = this.getFormat();
            }
            if (this.raw || raw) {
                if (this.response === undefined && this.responseText === undefined) {
                    var val;
                    $.each(this.results, function(index, element){
                        if (!val) {
                            val = element.getContent(format, true);
                        }
                    });
                    if (val) {
                        return val
                    }
                }
                return this.response || ((format === undefined || format == 'json') && typeof(this.responseText) == 'string' && this.responseText ? JSON.parse(this.responseText) : this.responseText)
            }else{
                var obj = this.getResource()
                return obj.__onLoad(format);                
            }
        },
        
        getRequest: function(){
            if (!this.request) {
                var val;
                $.each(this.results, function(index, element){
                    if (!val) {
                        val = element.getRequest();
                    }
                });
                if (val) {
                    return val
                }
            }
            return this.request
        },
        
        _get_as: function(name, force){
            if (!this.wasSuccessfull && !force) {
                return null
            }
            if (!this['_' + name]) {
                var val;
                $.each(this.results, function(index, element){
                    if (!val) {
                        val = element._get_as(name);
                    }
                });
                if (val) {
                    this['_' + name] = val;
                }
            }
            if (!this['_' + name] || !this['_' + name].__onGet) {
                if (!this._getResourceType(name)) {
                    throw Error('unknown resource type: "' + name + '"')
                }
                this['_' + name] = this.getNew(name);
                this['_' + name].__updateFromResponse(this.getResponse(), this);
            }
            return this['_' + name].__onGet(true);
        },
        
        _getResourceType: function(name){
            var resources = require('introspective-api-resources');
            return resources[name]
        },
        
        getNew: function(name){
            return new (this._getResourceType(name))(this.getNewConfig(name));
        },
        
        getNewConfig: function(name){
            var url = this.getRequest().url,
                xhr = this.getXhr();
            if (xhr && xhr.getResponseHeader('Location')) {
                url = xhr.getResponseHeader('Location');
            }
            return $.extend({url: url, result: this}, this._config)
        },
        
        getResource: function(force){
            return this._get_as('Resource', force)
        },
        
        getList: function(force){
            return this._get_as('List', force)
        },
        
        getResponseType: function(){
            return this.getXhr().getResponseHeader('X-ViewType')
        },
        
        get: function(){
            var type = this.getResponseType();
            if (type) {
                if (type == 'List') {
                    return this.getList();
                }else if (['Detail', 'Create'].indexOf(type) != -1){
                    return this.getResource()
                }
            }
            
            var ranges = this.getXhr().getResponseHeader('Accept-Ranges');
            if (ranges) {
                return this.getList();
            }
            return this.getResource()
        },
        
        getObject: function(){
            throw Error('use getResource instead')
        },
        
        registerXhr: function(xhr){
            this.jqXHR = xhr
        },
        
        getXhr: function(){
            if (!this.jqXHR) {
                var val;
                $.each(this.results, function(index, element){
                    if (!val) {
                        val = element.getXhr();
                    }
                });
                if (val) {
                    return val
                }
            }
            return this.jqXHR
        },
        
        getHeaderLinks: function(){
            return parseLinkHeader(this.getXhr().getResponseHeader('Link'))
            
        },
        
        getHeaderLinkTemplates: function(){
            return parseLinkTemplateHeader(this.getXhr().getResponseHeader('Link-Template'));
        },
        
        getSettings: function(){
            if (!this.settings || $.isEmptyObject(this.settings)) {
                var val;
                $.each(this.results, function(index, element){
                    if (!val) {
                        val = element.getSettings();
                    }
                });
                if (val) {
                    return val
                }
            }
            return this.settings
        }
        
    });
    
    
    function Path() {
        this.init.apply(this, arguments);
    };
    utils.ApiPath = Path;
    
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
                    links[link] = unpackURL(url, data, this)
                }                
            }
            this.links = links;
            return links
        }
    });
    
    
    utils.EventMixin = {
        
        __initEventMixin: function(events){
            this.__event_handler = {};
            this._events = events;
        },
        
        __trigger: function (event_name, args) {
            var event = new utils.ApiObjectEvent(event_name);
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
                       _log(this.__log, 'error', ['could not execute event "'+ event_name +'"', event, 'callback:', this.__event_handler[event_name][i], 'got error:', e, 'at', e.stack])
                   }
                }
            }
        },
        
        __bind: function (event, callback) {
            var $this = this;
            if (event.slice(-1) == '*') {
                var event_prefix = event.slice(0,event.length-1),
                    prefix_length = event_prefix.length;
                if (this._events.hasOwnProperty(event_prefix)) {
                    this.__bind(event_prefix, callback);
                    function onChildren(container, __event) {
                        for (var _event in container[__event]){
                            $this.__bind(_event, callback);
                            onChildren(container[__event], _event);
                        }
                    }
                    onChildren(this._events, event_prefix)
                }else{
                    for (var _event in this._events) {
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
        
        bind: function(){
            return this.__bind.apply(this, arguments)
        },
    }
    
    
    return utils;
})
    