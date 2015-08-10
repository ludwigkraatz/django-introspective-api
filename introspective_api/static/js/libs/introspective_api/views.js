define(['jquery', 'introspective-api-object', 'introspective-api-log', 'json'], function ($, ApiObject, _log, JSON) {

    /* an EndpointDetail view shows a resource
    */
    function EndpointDetail() {
        this.__init.apply(this, arguments);
    };
    
    $.extend(EndpointDetail.prototype, {
        api_object_class: null,
        __init: function(apiClient, parent, target, data){

        },
        
        handle: function(){
            // ApiObject: prepare specific Resource or simply object
            // EndpointView: prepare list of Resources/Objects
            // url: fetch url and prepare result
        },
    });

    /* lists whatever ApiObject / EndpointView is provided
    */
    function EndpointList() {
        this.__init.apply(this, arguments);
    };
    
    
    return {
        EndpointDetail: EndpointDetail,
        EndpointList: EndpointList
    };
});