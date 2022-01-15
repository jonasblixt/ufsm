.. _Building and installing:

-----------------------
Building and installing
-----------------------

Building using the docker environment::

    $ ./build_docker.sh
    $ ./run_docker.sh
    $ mkdir build && cd build/
    $ ../configure
    $ make
    $ ./ufsm-compose/ufsm-compose


Dependencies:

==========  ===================
Package     Ubuntu package name
==========  ===================
automake    automake, autoconf-archive, autoconf, pkgconf
libtool     libtool
uuid        uuid-runtime, uuid-dev
GTK 3       libgtk-3-0, libgtk-3-dev
==========  ===================

Running tests::

    $ ./configure --enable-code-coverage
    $ make && make check

.. toctree::
   :maxdepth: 1
   :glob:

   build/*

