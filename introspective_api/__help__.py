

def get_hints():
    if "populate() isn't reentrant":
        pass # .api -> ApiEndpoint().register(view_name='xxx') with 'xxx' already used once
