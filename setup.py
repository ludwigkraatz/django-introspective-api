from setuptools import setup, find_packages
from pip.req import parse_requirements

requirements = []
dependencies = []


for requirement in parse_requirements('requirements.txt'):
    requirements.append(str(requirement.req))
    if requirement.url:
        dependencies.append(str(requirement.url))


setup(
    name="introspective_api",
    author="Ludwig Kraatz",
    author_email="code@suncircle.de",
    version='0.1.1',
    packages=find_packages(),
    include_package_data=True,
    install_requires=requirements,
    dependency_links=dependencies
)
