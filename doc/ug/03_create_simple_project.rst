.. _ug-simple-project:

-----------------------
Create simple a project
-----------------------

Open the compose editor by running 'ufsm-compose'.

.. image:: ../compose_main_window.png

A good start is to open the project settings menu and set a project name and
maybe adjust the canvas size. The project settings menu is opened by pressing 'p'

.. image:: ../compose_project_settings.png

Create a model by adding normal states 'a-s' (Add state).
Set the state names by pressing 'e-n' (Edit - name). 

See :ref:`ug-editor-commands` for a more comprehensive list of commands.

.. image:: ../compose_demo_project.png

Translate model to code::

    $ ufsm-generate --input led.ufsm --output led

This command generated led.c and led.h which contains the state machine.
These two files should be linked together width ufsm.c (or libufsm-core) to
produce a working state machine.
