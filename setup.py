from setuptools import setup, find_packages
from pip.req import parse_requirements

requirements = []
dependencies = []


for requirement in parse_requirements('requirements.txt'):
    if requirement.url:
        url = str(requirement.url)
        dependencies.append(url)
        requirements.append(str(requirement.req) + '==' + url.split('-')[-1])
    else:
        requirements.append(str(requirement.req))


setup(
    name="introspective-api",
    author="Ludwig Kraatz",
    author_email="code@suncircle.de",
    version='0.1.4',
    packages=find_packages(),
    include_package_data=True,
    install_requires=requirements,
    dependency_links=dependencies
)
