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

    led_init(&m, NULL);
    led_process(&m, UFSM_RESET);
    led_process(&m, eToggle);
    led_process(&m, eToggle);
    led_process(&m, eToggle);
    led_process(&m, eToggle);
    led_process(&m, eToggle);

    return 0;
}

