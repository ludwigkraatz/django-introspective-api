from setuptools import setup, find_packages
from pip.req import parse_requirements
import os

requirements = []
dependencies = []


for requirement in parse_requirements('requirements.txt'):
    if requirement.url:
        url = str(requirement.url)
        egg = url.split('#egg=')[-1]
        if '#egg=' in url and '.' in egg:
            version = egg.split('-')[-1]
            requirements.append(str(requirement.req) + '==' + version)
        dependencies.append(url)
    else:
        requirements.append(str(requirement.req))


def get_package_data(package):
    """
    Return all files under the root package, that are not in a
    package themselves.
    """
    walk = [(dirpath.replace(package + os.sep, '', 1), filenames)
            for dirpath, dirnames, filenames in os.walk(package)
            if not os.path.exists(os.path.join(dirpath, '__init__.py'))]

    filepaths = []
    for base, filenames in walk:
        filepaths.extend([os.path.join(base, filename)
                          for filename in filenames])
    return {package: filepaths}

setup(
    name="introspective-api",
    author="Ludwig Kraatz",
    author_email="code@suncircle.de",
    version='0.1.24',
    packages=find_packages(),
    include_package_data=True,
    package_data=get_package_data('introspective_api'),
    install_requires=requirements,
    dependency_links=dependencies
)
