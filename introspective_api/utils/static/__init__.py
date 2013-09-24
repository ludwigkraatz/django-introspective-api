from django.template.loader import render_to_string
import os

from django.conf import settings

from introspective_api.settings import api_settings

def assert_correct_config_syntax(config):
    """
    @brief checks, whether the config is in correct syntax
    """
    #TODO
    pass

def get_config():
    """
    @returns valid configs or throws an exception
    """
    config = api_settings.STATIC_ENDPOINT_CONFIG
    if callable(config):
        return config()
    
    assert_correct_config_syntax(config)
    return config
        
def update_statics(log=None):
    """
    @brief this method creates all static files (e.g. js files with endpoint definition)
    """
    config = get_config()
    
    target_dir = settings.STATIC_ROOT + ('endpoints/')
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)
    
    for endpoint in config.get('endpoints', []):
        with open(target_dir+endpoint['js']['file_name'], "w") as cur_endpoint:
            cur_endpoint.write(
                render_to_string('introspective_api/endpoint_template.js', {
                    'endpoint': endpoint,
                    'config': config
                    })
                )
            
            if log:
                log.write("updated '%s'" % endpoint['js']['file_name'])
        
    
    
    