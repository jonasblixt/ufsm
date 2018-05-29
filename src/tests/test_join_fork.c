#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include <test_join_fork_input.h>
#include "common.h"

int main(int argc, char **argv) 
{
    struct ufsm_machine *m = get_StateMachine1();
    
    m->debug_transition = &debug_transition;
    m->debug_enter_region = &debug_enter_region;
    m->debug_leave_region = &debug_leave_region;
    m->debug_event = &debug_event;
    m->debug_action = &debug_action;
    m->debug_guard = &debug_guard;

    ufsm_init_machine(m);
    return 0;
}
