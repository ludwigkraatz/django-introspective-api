define(['jquery', 'introspective-api-resources', 'introspective-api-log', 'json'], function ($, apiResources, _log, JSON) {

    function DataCache() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(DataCache.prototype, {
        __init: function(){
            
        },
        
        update: function(){
            
        },
        
        fetch: function(client, args){
            
        },
        
        process: function(client, args){
            
        }
        
        
    });
    
    var __cache = new DataCache();

    function CacheClient() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(CacheClient.prototype, {
        __init: function(){
            
        },
        /*
         * by_url:
         *      /abc/: ApiList
         *      /abc/3/: ApiObject
         * by_object:
         *      ApiObject_1:
         *          'json': EndpointView
         *          'print': EndpointView
         */

        handle: function(subject, config){
            // ajax clients probably will use subject.urls,
            return null
        },

        provide: function(subject, config){
            
            
            if (config && config['return']) {
                if (apiResources[config['return']]){
                    return new apiResources[config['return']](subject);
                }
            }
            throw Error('TODO: implement return demand for ' + config['return'])
            // hosts more likely will use an own system, providing object oriented approaches.
            this.handle(subject, config)
            // TODO: callback(result.getObject())
            return null
        },
        
        process: function(){
            __cache.process(this, arguments);
        },
        
        fetch: function(){
            return __cache.fetch(this, arguments);
        }
    })
    

    function DummyClient() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(DummyClient.prototype, {
        __init: function(){
            
        },
        
        process: function(){
            // do nothing
        },
        
        fetch: function(){
            return undefined
        }
    })
    
    
    
    return {
        CacheClient: CacheClient,
        DummyClient: DummyClient,
    };
});