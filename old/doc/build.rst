.. _Building and installing:

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

