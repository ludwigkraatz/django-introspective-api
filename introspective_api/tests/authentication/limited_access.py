from django.conf.urls.defaults import patterns, include
from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.utils import unittest

from django.utils import simplejson as json
from django.http import HttpResponse

from introspective_api.views import APIView
from rest_framework import permissions

from introspective_api.authentication import ConsumerAuthentication
from introspective_api.utils.test import override_settings

import base64


class MockView(APIView):
    permission_classes = (permissions.IsAuthenticated,)

    def post(self, request):
        return HttpResponse({'a': 1, 'b': 2, 'c': 3})

    def put(self, request):
        return HttpResponse({'a': 1, 'b': 2, 'c': 3})

MockView.authentication_classes += (ConsumerAuthentication,)

urlpatterns = patterns('',
    (r'^$', MockView.as_view()),
)

@unittest.skip
@override_settings(AUTH_CONSUMER_MODEL='introspective_api.Consumer',
                   AUTH_ACCESS_KEY_MODEL='introspective_api.AccessKey')
class ConsumerAuthTests(TestCase):
    """Consumer and AccesKey authentication"""
    urls = 'introspective_api.tests.authentication.limited_access'

    def setUp(self):
        self.csrf_client = Client(enforce_csrf_checks=True)
        self.username = 'john'
        self.email = 'lennon@thebeatles.com'
        self.password = 'password'
        self.user = User.objects.create_user(self.username, email=self.email, password=self.password)
        
        self.consumer1 = 'consumer1'
        self.consumer1_obj = api_settings.AUTH_CONSUMER_MODEL.objects.create_consumer(self.consumer1)
        
        self.acceskey1 = 'accesskey1'
        self.acceskey1_obj = api_settings.AUTH_ACCESS_KEY_MODEL.objects.create_key(self.user)

    def test_post_form_passing_basic_auth(self):
        """Ensure POSTing json over basic auth with correct credentials passes and does not require CSRF"""
        auth = 'Basic %s' % base64.encodestring('%s:%s' % (username=self.username, self.password)).strip()
        response = self.csrf_client.post('/', {'example': 'example'}, HTTP_AUTHORIZATION=auth)
        self.assertEqual(response.status_code, 200)

    def test_post_json_passing_basic_auth(self):
        """Ensure POSTing form over basic auth with correct credentials passes and does not require CSRF"""
        auth = 'Basic %s' % base64.encodestring('%s:%s' % (self.username, self.password)).strip()
        response = self.csrf_client.post('/', json.dumps({'example': 'example'}), 'application/json', HTTP_AUTHORIZATION=auth)
        self.assertEqual(response.status_code, 200)

    def test_post_form_failing_basic_auth(self):
        """Ensure POSTing form over basic auth without correct credentials fails"""
        response = self.csrf_client.post('/', {'example': 'example'})
        self.assertEqual(response.status_code, 403)

    def test_post_json_failing_basic_auth(self):
        """Ensure POSTing json over basic auth without correct credentials fails"""
        response = self.csrf_client.post('/', json.dumps({'example': 'example'}), 'application/json')
        self.assertEqual(response.status_code, 403)
