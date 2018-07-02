#include <stdio.h>
#include <ufsm.h>
#include "ufsm_demo_fsm.h"

void led_on(void)
{
    printf("LED ON\n");
}

void led_off(void)
{
    printf("LED OFF\n");
}

int main(int argc, char** argv)
{
    struct ufsm_machine* m = get_StateMachine1();

    ufsm_init_machine(m);

    ufsm_process(m, EV);

    ufsm_process(m, EV);

    ufsm_process(m, EV);

    ufsm_process(m, EV);

    ufsm_process(m, EV);

    return 0;
}
