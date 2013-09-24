
require.config({

    packages: [
        {% for js_package in config.js.packages %}
        {
            name: "{{js_package.name}}",
            main: "{{js_package.main}}",
            location: "{{js_package.location}}"
        },
        {% endfor %}
    ],
    paths: {
        {% for path in config.js.paths %}"{{path.name}}": "{{path.location}}",
        {% endfor %}
    },
});


{% block pre_init %}var {{ endpoint.js.var_name }};{% endblock %}
require(['{% firstof endpoint.js.requirements.jquery "jquery" %}', '{% firstof endpoint.js.requirements.endpoint "introspective-api-endpoint" %}'], function ($, Endpoint){    
    $(function(){
        {% block init %}
        {{ endpoint.js.var_name }} = new Endpoint({
            endpoint: '{{ endpoint.url }}',
            crossDomain: {% if endpoint.is_cross_domain %}true{%else%}false{%endif%}{% comment %}TODO JS can figure out if its the same host and port or not...{% endcomment %}
        });
        {% endblock %}
    });
});