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

bool guard1 (uint32_t ev) {
    flag_guard1_called = true;
    return guard1_return_val;
}


bool guard2 (uint32_t ev) {
    flag_guard2_called = true;
    return guard2_return_val;
}


void action1 (uint32_t ev) {
    flag_action1_called = true;
}



struct ufsm_state state_state1;
struct ufsm_state state_state2;

struct ufsm_state state_init = {
    .name = "Init",
    .tbl = { 
      /* Event  , Guards                , Actions , Next state     */
        {EV_INIT, {guard1, guard2, NULL}, {NULL}  , &state_state1},
        UFSM_SENTINEL
    },
};

struct ufsm_state state_state1 = {
    .name = "State1",
    .tbl = { 
        {EV_EVENT2, {guard1, NULL}, {action1, NULL}, &state_state2},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
};


struct ufsm_state state_state2 = {
    .name = "State2",
    .tbl = { 
        {EV_EVENT1, {NULL}, {NULL}, &state_state1},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
};


bool test_simple() {
    struct ufsm_machine m;
    bool test_ok = true;
    bool err = false;

    printf ("Simple test:\n");

    ufsm_init (&m, &state_init);
 
    printf (" o Transition from INIT to STATE1: ");
    guard1_return_val = true;
    guard2_return_val = true;

    err = ufsm_process(&m, EV_INIT);
    
    if (ufsm_state(&m) == &state_state1 && err == false &&
        flag_guard1_called && flag_guard2_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL, %s %i\n", ufsm_state(&m)->name, err);
        test_ok = false;
    }

    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;

    printf (" o Unhandeled event: ");

    err = ufsm_process(&m, EV_EVENT1);

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
 
    err = ufsm_process(&m, EV_EVENT2);

    if (ufsm_state(&m) == &state_state2 && err == false && flag_guard1_called
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

    err = ufsm_process(&m, EV_EVENT3);

    if (ufsm_state(&m) == &state_state2 && !err && !flag_guard1_called
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

    err = ufsm_process(&m, EV_EVENT1);

    if (ufsm_state(&m) == &state_state1 && !err && !flag_guard1_called &&
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

    err = ufsm_process(&m, EV_EVENT2);

    if (ufsm_state(&m) == &state_state1 && !err && flag_guard1_called &&
        !flag_guard2_called && !flag_action1_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL, current_state = %s, err = %i\n",ufsm_state(&m)->name,err);
        test_ok = false;
    }


    return test_ok;
}
