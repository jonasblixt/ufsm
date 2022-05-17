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

    dimmer_init(&m, NULL);

    dimmer_process(&m, UFSM_RESET);
    dimmer_process(&m, eButton);
    dimmer_process(&m, eButton);
    dimmer_process(&m, eOffButton);
    dimmer_process(&m, eButton);
    dimmer_process(&m, eButton);
    dimmer_process(&m, eButton);
    dimmer_process(&m, eButton);
    return 0;
}

