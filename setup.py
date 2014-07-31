from setuptools import setup, find_packages


def get_path(fname):
    return os.path.join(os.path.dirname(__file__), fname)


def read(fname):
    return open(get_path(fname)).read()


setup(
    name="introspective_api",
    author="Ludwig Kraatz",
    author_email="code@suncircle.de",
    version='0.1',
    packages=find_packages(),
    include_package_data=True,
    install_requires=read('requirements.txt').split("\n"),
)
