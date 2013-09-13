"""
Force import of all modules in this package in order to get the standard test
runner to pick up the tests.  Yowzers.
"""
import os

modules = [filename.rsplit('.', 1)[0]
           for filename in os.listdir(os.path.dirname(__file__))
           if not filename.endswith('.py') and not filename.endswith('.pyc')]
__test__ = dict()

for module in modules:
    try:
        exec("from introspective_api.tests.%s.tests import *" % module)
    except ImportError, e:
        print 'error importing test package "%s": "%s"' % (module, e)