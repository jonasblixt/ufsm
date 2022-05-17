#!/usr/bin/env python

from setuptools import setup
from setuptools import find_packages
import re

setup(name='ufsm-compile',
      version='0.0.0',
      description='UFSM code generator',
      long_description='',
      author='Jonas Blixt',
      author_email='jonpe960@gmail.com',
      license='BSD3',
      classifiers=[
          'License :: OSI Approved :: BSD3 License',
          'Programming Language :: Python :: 3',
      ],
      keywords=['fsm', 'ufsm', 'statechart'],
      url='https://github.com/jonasblixt/ufsm',
      packages=['ufsm_compile'],
      install_requires=[],
      test_suite="tests",
      entry_points = {
          'console_scripts': ['ufsm-compile=ufsm_compile.__main__:main']
      })
