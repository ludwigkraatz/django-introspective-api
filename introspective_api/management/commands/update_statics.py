from django.core.management.base import BaseCommand, CommandError
from introspective_api.utils.static import update_statics

class Command(BaseCommand):
    
    #args = '<poll_id poll_id ...>'
    #help = 'Closes the specified poll for voting'

    def handle(self, *args, **options):
        try:
            update_statics(log=self.stdout)
        except BaseException, e:
            raise# CommandError('Error')