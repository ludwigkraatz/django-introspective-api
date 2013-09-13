from django.db.models import Model, fields
from jsonfield.fields import JSONField


class ApiSitemapVersion(object):
    class Meta:
        get_latest_by = 'id'
    
    version             = fields.TextField()
    depreciation_date   = fields.DateField(blank=True, null=True)
    content             = JSONField(default="{}")

def get_sietemap_for_version(version):
    try:
        if version:
            sitemap = ApiSitemapVersion.objects.get(version=version)
        else:
            sitemap = ApiSitemapVersion.objects.latest()
    except ApiSitemapVersion.DoesNotExist:
        raise Exception, 'not found'
    
    return sitemap.content