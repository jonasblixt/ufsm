.. image:: doc/logo.png
    :width: 10 %
.. image:: https://github.com/jonasblixt/ufsm/actions/workflows/build.yml/badge.svg
    :target: https://github.com/jonasblixt/ufsm/actions/workflows/build.yml
.. image:: https://readthedocs.org/projects/ufsm/badge/?version=latest
    :target: https://ufsm.readthedocs.io/en/latest/?badge=latest
    :alt: Documentation Status

uFSM is a tool for drawing hierarchical state machines and generating code.
The two main parts are "ufsm-compose" the graphical editor and "ufsm-generate",
The code generator.

.. image:: doc/ufsm_design_guides.gif

----------
Disclaimer
----------

uFSM is a work in progress, it's incomplete, it fully possible to design machines
that will not work.

-------
History
-------

    - Versions 0.1 - 0.3
        Used a rather complicated runtime that operated on a tree structure that's
        true to the graphical representation of a state machine. This worked but
        was resource hungry and error prone.

        The first versions also relied on external drawing tools and used the
        XMI format to translate designs to compilable code.

    - Version 0.4.x
        Shipped "ufsm compose" drawing tool

    - Version 0.5.x
        Fundametal change in how code is generated. From 0.5 and onward the complicated
        runtime is dropped in favor of a code generator that computes most things
        statically. This reduces the runtime memory requirements substantially.

------------
Future plans
------------

    - Add more code generator backends, for example rust, js and python
    - DRC, design rule checker
    - BDD based state condition rule optimizer

-----------------------
Building and installing
-----------------------

Appimages for linux:

    Under releases appimages are available for the drawing tool and the code
    generator. This is the easiest way to quickly test ufsm.

Building::

    $ mkdir build && cd build
    $ cmake ..
    $ make

Dependencies:

==========  ===================
Package     Ubuntu package name
==========  ===================
cmake       cmake
uuid        uuid-runtime, uuid-dev
GTK 3       libgtk-3-0, libgtk-3-dev
==========  ===================

Running tests::

    $ make tests


Documentation is available here: `uFSM documentation`_

.. _uFSM documentation: http://ufsm.readthedocs.io/en/latest
