from setuptools import find_packages, setup
import re


def readme():
    with open('README.md', encoding='utf-8') as f:
        return f.read()


def get_version():
    """Read version directly from version.py without exec() (safe on all Python versions)."""
    with open('rtmlib/version.py', 'r') as f:
        content = f.read()
    match = re.search(r"^__version__\s*=\s*['\"]([^'\"]+)['\"]", content, re.MULTILINE)
    if not match:
        raise RuntimeError("Cannot find __version__ in rtmlib/version.py")
    return match.group(1)


def parse_requirements(fname='requirements.txt'):
    """Read a flat requirements.txt and return a list of package strings."""
    import os
    if not os.path.exists(fname):
        return []
    reqs = []
    with open(fname, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and not line.startswith('-'):
                reqs.append(line)
    return reqs


setup(
    name='rtmlib',
    version=get_version(),
    description='A library for real-time pose estimation.',
    author='Tau-J',
    author_email='taujiang@outlook.com',
    keywords='pose estimation',
    long_description=readme(),
    long_description_content_type='text/markdown',
    packages=find_packages(),
    include_package_data=True,
    url='https://github.com/Tau-J/rtmlib',
    license='Apache License 2.0',
    python_requires='>=3.7',
    install_requires=parse_requirements('requirements.txt'),
)
