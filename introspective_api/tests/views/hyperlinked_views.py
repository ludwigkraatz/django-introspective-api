from django.conf.urls import patterns, url
from django.test import TestCase
from django.utils import unittest
from django.test.client import RequestFactory
from rest_framework import status
from introspective_api import generics, fields, serializers
from introspective_api.tests.models import Foo
from introspective_api.utils.test import override_settings

def null_view(request):
    pass

factory = RequestFactory()
    
class BaseFooSerializer(serializers.ModelSerializer):
    url = fields.HyperlinkedIdentityField(view_name='foo-view')
    bar = fields.HyperlinkedRelatedView('bar-view', pk_url_kwarg='foo')
    other = fields.HyperlinkedRelatedView('other-view', pk_query_kwarg='foo')
    class Meta:
        model = Foo
        exclude = ('url',)
    
class FooSerializer(BaseFooSerializer):
    bar = fields.HyperlinkedRelatedView('bar-view', pk_url_kwarg='foo')
    other = fields.HyperlinkedRelatedView('other-view', pk_query_kwarg='foo')
    class Meta:
        model = Foo
        exclude_meta = ('url',)
        exclude = ('url',)
    
class BarSerializer(serializers.ModelSerializer):
    foo = fields.HyperlinkedRelatedView('foo-view')
    other = fields.HyperlinkedRelatedView('other-view', pk_query_kwarg='bar')
    class Meta:
        model = Foo
        meta_fields = ('other',)

class FooView(generics.RetrieveAPIView):
    serializer_class = FooSerializer
    model = Foo

class FoosView(generics.ListAPIView):
    serializer_class = BaseFooSerializer
    model = Foo

class BarView(generics.RetrieveAPIView):
    serializer_class = BarSerializer
    model = Foo
    pk_url_kwarg = 'foo'

urlpatterns = patterns('',
    url(r'^foo/(?P<pk>[0-9]*)/$', FooView.as_view(), name='foo-view'),
    url(r'^foos/$', FoosView.as_view(), name='foos-view'),
    url(r'^bar/(?P<foo>[0-9]*)/$', BarView.as_view(), name='bar-view'),
#    url(r'^bar/(?[0-9]*)/$', BarView.as_view(), name='bar-view'),
    url(r'^other/$', null_view, name='other-view'),
)

class IntegrationTestHyperlinkedView(TestCase):
    """
    Integration tests for paginated list views.
    """
    urls = 'introspective_api.tests.hyperlinked_views'

    def setUp(self):
        """
        Create one Foo object
        """
        Foo.objects.create()

    @override_settings(RELATED_VIEWS_IN_HEADER=False)
    def test_get_related_view_hyperlink(self):
        """
        Response containing a HyperlinkedRelatedView Field should return a hyperlink
        in the response dict to the specified View
        """
        response = self.client.get('/foo/1/')
        
        self.assertEquals(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('Link', response.data)
        self.assertEquals(response.data, {'bar': 'http://testserver/bar/1/',
                                          'other': 'http://testserver/other/?foo=1',
                                          'id': 1})
        
        response = self.client.get('/bar/1/')
        
        self.assertEquals(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('Link', response.data)
        self.assertEquals(response.data, {'foo': 'http://testserver/foo/1/',
                                          'other': 'http://testserver/other/?bar=1',
                                          'id': 1})

    def test_get_related_view_hyperlink_in_header(self):
        """
        Response containing a HyperlinkedRelatedView Field should return a hyperlink
        in the responses header to the specified View
        """
        response = self.client.get('/foo/1/')
        
        
        self.assertEquals(response.status_code, status.HTTP_200_OK)
        self.assertEquals(response.data, {'id': 1})
        self.assertEquals(response['Link'], '<http://testserver/bar/1/>; rel="related"; title="bar", <http://testserver/other/?foo=1>; rel="related"; title="other"')

        response = self.client.get('/bar/1/')
        
        self.assertEquals(response.status_code, status.HTTP_200_OK)
        self.assertEquals(response.data, {'id': 1})
        self.assertEquals(response['Link'], '<http://testserver/other/?bar=1>; rel="related"; title="other"')
        
        
        response = self.client.get('/foos/')
        
        self.assertEquals(response.status_code, status.HTTP_200_OK)
        self.assertEquals(response.data, [{'id': 1}])
        self.assertNotIn('Link', response)
        self.assertEquals(response['Link-Template'], '<http://testserver/foo/{id}/>; rel="self", <http://testserver/bar/{id}/>; rel="related"; title="bar", <http://testserver/other/?foo={id}>; rel="related"; title="other"')
        