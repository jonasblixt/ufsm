.. _c-generator:

----------------
C code generator
----------------

The c code generator is invoked by running 'ufsm-generate'::

    $ ufsm-generate --help
    ufsm-generate 0.4.0

    Usage:
        ufsmimport [options]

    Options:
            -i, --input <input filename>            - Input filename
            -o, --output <output filename>          - Output filename
            -v, --verbose                           - Verbose
            -s, --strip=<level>                     - Strip output

    Strip levels:
        0 - Nothing is stripped
        1 - UUID references stripped, this is the default
        2 - Strip UUID's and text labels

By adding --strip the output size can be reduced for memory constrained devices.
