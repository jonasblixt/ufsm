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

    $ ufsm-generate c led.ufsm .

This command generates led.c and led.h which contains the state machine.

Example code::

    #include <stdio.h>
    #include "led.h"

    void led_on(void *context)
    {
        printf("LED ON\n");
    }

    void led_off(void *context)
    {
        printf("LED OFF\n");
    }

    int main(int argc, char **argv)
    {
        struct led_machine m;

        led_init(&m, NULL);

        led_process(&m, eToggle);
        led_process(&m, eToggle);
        led_process(&m, eToggle);
        led_process(&m, eToggle);
        led_process(&m, eToggle);

        return 0;
    }

Build the example::

    gcc simple.c led.c -o led

Source code: :github-tree:`examples/simple`
