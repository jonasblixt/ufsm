#include <ufsm/ufsm.h>
#include <stdio.h>
#include "dimmer.h"

void lamp_10_percent(void *context)
{
    printf("Lamp 10%%\n");
}

void lamp_30_percent(void *context)
{
    printf("Lamp 30%%\n");
}

void lamp_50_percent(void *context)
{
    printf("Lamp 50%%\n");
}

void lamp_100_percent(void *context)
{
    printf("Lamp 100%%\n");
}

void lamp_off(void *context)
{
    printf("Lamp off\n");
}

int main(int argc, char **argv)
{
    struct dimmer_machine m;

    ufsm_debug_machine(&m.machine);
    dimmer_machine_initialize(&m, NULL);

    dimmer_machine_process(&m, eButton);
    dimmer_machine_process(&m, eButton);
    dimmer_machine_process(&m, eOffButton);
    dimmer_machine_process(&m, eButton);
    dimmer_machine_process(&m, eButton);
    dimmer_machine_process(&m, eButton);
    dimmer_machine_process(&m, eButton);
    return 0;
}

