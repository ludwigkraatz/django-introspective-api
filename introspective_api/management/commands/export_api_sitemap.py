from django.core.management.base import BaseCommand, CommandError
from introspective_api.endpoints import api_root

from django.conf import settings
from django.utils.importlib import import_module

import pprint

class Command(BaseCommand):
    
    #args = '<poll_id poll_id ...>'
    #help = 'Closes the specified poll for voting'

    def handle(self, *args, **options):
        version = '1.0'
        
        for app_name in settings.INSTALLED_APPS:
            try:
                import_module('.urls', app_name)
            except ImportError as exc:
                # This is slightly hackish. We want to ignore ImportErrors
                # if the "management" module itself is missing -- but we don't
                # want to ignore the exception if the management module exists
                # but raises an ImportError for some reason. The only way we
                # can do this is to check the text of the exception. Note that
                # we're a bit broad in how we check the text, because different
                # Python implementations may not use the same text.
                # CPython uses the text "No module named management"
                # PyPy uses "No module named myproject.myapp.management"
                msg = exc.args[0]
                if not msg.startswith('No module named') or 'urls' not in msg:
                    raise
        try:
            self.stdout.write(pprint.pformat(api_root.generate_sitemap(version)))
        except BaseException, e:
            raise# CommandError('Error')