.. _c-generator:

----------------
C code generator
----------------

The c code generator is invoked by running 'ufsm-generate'::

    $ ufsm-generate --help
    usage: ufsm-generate [-h] [-v {0,1,2}] [--version] {c} ... model output_dir

    uFSM generator

    positional arguments:
      {c}                   Code generator backend
      model                 Input model
      output_dir            Output directory

    options:
      -h, --help            show this help message and exit
      -v {0,1,2}, --verbose {0,1,2}
                            Control the verbosity; disable(0), warning(1) and debug(2) (default: 1).
      --version             Print version information and exit.
