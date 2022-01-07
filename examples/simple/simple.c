#include <ufsm/ufsm.h>
#include <stdio.h>
#include "led.h"

void led_on(void *context)
{
    printf ("LED ON\n");
}

void led_off(void *context)
{
    printf ("LED OFF\n");
}

int main(int argc, char **argv)
{
    struct led_machine m;

    ufsm_debug_machine(&m.machine);
    led_machine_initialize(&m, NULL);

    led_machine_process(&m, eToggle);
    led_machine_process(&m, eToggle);
    led_machine_process(&m, eToggle);
    led_machine_process(&m, eToggle);
    led_machine_process(&m, eToggle);

    return 0;
}

