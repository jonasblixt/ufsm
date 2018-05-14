#include <stdio.h>
#include <ufsm.h>

#include "simple.h"

enum events {
    EV_INIT,
    EV_EVENT1,
    EV_EVENT2,
    EV_EVENT3,
    EV_END,
};


bool flag_action1_called = false;
bool flag_guard1_called = false;
bool flag_guard2_called = false;

bool guard1_return_val = false;
bool guard2_return_val = false;

bool guard1 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_guard1_called = true;
    return guard1_return_val;
}


bool guard2 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_guard2_called = true;
    return guard2_return_val;
}


bool action1 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_action1_called = true;
    return true;
}



struct ufsm_state state_state1;
struct ufsm_state state_state2;

struct ufsm_state state_init = {
    .name = "Init",
    .entry = NULL,
    .tbl = { 
      /* Event  , Guards                , Actions , Next state     */
        {EV_INIT, {guard1, guard2, NULL}, {NULL}  , &state_state1},
        UFSM_SENTINEL
    },
    .exit = NULL,
};

struct ufsm_state state_state1 = {
    .name = "State1",
    .entry = NULL,
    .tbl = { 
        {EV_EVENT2, {guard1, NULL}, {action1, NULL}, &state_state2},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
    .exit = NULL,
};


struct ufsm_state state_state2 = {
    .name = "State2",
    .entry = NULL,
    .tbl = { 
        {EV_EVENT1, {NULL}, {NULL}, &state_state1},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
    .exit = NULL,
};


bool test_simple() {
    struct ufsm_machine m;
    struct ufsm_event ev;
    bool test_ok = true;
    bool err = false;

    printf ("Simple test:\n");

    ufsm_init (&m, &state_init);
 
    printf (" o Transition from INIT to STATE1: ");
    guard1_return_val = true;
    guard2_return_val = true;

    ev.id = EV_INIT;
    err = ufsm_process(&m, &ev);
    
    if (m.state_matrix[0] == &state_state1 && err == false &&
        flag_guard1_called && flag_guard2_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL, %s %i\n", m.state_matrix[0]->name, err);
        test_ok = false;
    }

    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;

    printf (" o Unhandeled event: ");

    ev.id = EV_EVENT1;
    err = ufsm_process(&m, &ev);

    if (err && !flag_guard1_called && !flag_guard2_called &&
            !flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL\n");
        test_ok = false;
    }

    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;


    printf (" o Transition from STATE1 to STATE2: ");
 
    ev.id = EV_EVENT2;
    err = ufsm_process(&m, &ev);

    if (m.state_matrix[0] == &state_state2 && err == false && flag_guard1_called
        && !flag_guard2_called && flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL\n");
        test_ok = false;
    }

    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;


    printf (" o Internal transistion in STATE2: ");

    ev.id = EV_EVENT3;
    err = ufsm_process(&m, &ev);


    if (m.state_matrix[0] == &state_state2 && !err && !flag_guard1_called
        && !flag_guard2_called && !flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL\n");
        test_ok = false;
    }

    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;


    printf (" o Transition from STATE2 to STATE1: ");

    ev.id = EV_EVENT1;
    err = ufsm_process(&m, &ev);

    if (m.state_matrix[0] == &state_state1 && !err && !flag_guard1_called &&
        !flag_guard2_called && !flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL\n");
        test_ok = false;
    }


    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;
    
    guard1_return_val = false;


    printf (" o Transition from STATE1 to STATE2 with guard1_val = false : ");

    ev.id = EV_EVENT2;
    err = ufsm_process(&m, &ev);

    if (m.state_matrix[0] == &state_state1 && !err && flag_guard1_called &&
        !flag_guard2_called && !flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL, current_state = %s, err = %i\n",m.state_matrix[0]->name,err);
        test_ok = false;
    }


    return test_ok;
}
