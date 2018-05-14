#include <stdio.h>
#include <ufsm.h>

#include "orthogonal.h"

enum events {
    EV_INIT,
    EV_EVENT1,
    EV_EVENT2,
    EV_EVENT3,
    EV_COMP_TEST,
    EV_END,
};


static bool flag_action1_called = false;
static bool flag_guard1_called = false;
static bool flag_guard2_called = false;

static bool action_comp3_called = false;
static bool action_comp2_called = false;



static bool guard1_return_val = false;
static bool guard2_return_val = false;

static bool guard1 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_guard1_called = true;
    return guard1_return_val;
}


static bool guard2 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_guard2_called = true;
    return guard2_return_val;
}


static bool action1 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    flag_action1_called = true;
    return true;
}

static bool action_comp2 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    printf ("action_comp2\n");
    return true;
}

static bool action_comp3 (const struct ufsm_state *state,
            const struct ufsm_machine *machine,
            const struct  ufsm_event *event) {
    printf ("action_comp3\n");
    return true;
}



static struct ufsm_state state_state1_composite_top;
static struct ufsm_state state_state1_composite1;
static struct ufsm_state state_state1_composite2;


static struct ufsm_state state_state2_composite;
static struct ufsm_state state_state3_composite;



static struct ufsm_state state_init = {
    .name = "Init comp",
    .entry = NULL,
    .tbl = { 
      /* Event  , Guards                , Actions , Next state     */
        {EV_INIT, {guard1, guard2, NULL}, {NULL}  , &state_state1_composite_top},
        UFSM_SENTINEL
    },
    .exit = NULL,
};


static struct ufsm_state state_state2_composite = {
    .name = "State2 comp",
    .entry = NULL,
    .tbl = {
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        {EV_COMP_TEST, {NULL}, {&action_comp2}, NULL},
        UFSM_SENTINEL
    },
    .exit = NULL,
};


static struct ufsm_state state_state3_composite = {
    .name = "State3 comp",
    .entry = NULL,
    .tbl = {
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        {EV_COMP_TEST, {NULL}, {&action_comp3}, NULL},
        UFSM_SENTINEL
    },
    .composite = NULL,
    .exit = NULL,
};


static struct ufsm_state state_state1_composite2 = {
    .name = "State1 orth 2",
    .entry = NULL,
    .tbl = {
        {EV_EVENT2, {guard1, NULL}, {action1, NULL}, &state_state3_composite},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
    .composite = NULL,
    .exit = NULL,
};



static struct ufsm_state state_state1_composite1 = {
    .name = "State1 orth 1",
    .entry = NULL,
    .tbl = {
        {EV_EVENT2, {guard1, NULL}, {action1, NULL}, &state_state2_composite},
        {EV_EVENT3, {NULL}, {NULL}, NULL},
        UFSM_SENTINEL
    },
    .composite =&state_state1_composite2,
    .exit = NULL,
};


static struct ufsm_state state_state1_composite_top = {
    .name = "State1 composite top",
    .entry = NULL,
    .tbl = {
        UFSM_SENTINEL
    },
    .composite = &state_state1_composite1,
    .exit = NULL,
};


bool test_orthogonal() {
    struct ufsm_machine m;
    struct ufsm_event ev;
    bool test_ok = true;
    bool err = false;

    printf ("Orthogonal test:\n");

    ufsm_init (&m, &state_init);
 
    printf (" o Transition from INIT to STATE1 COMP0: ");
    guard1_return_val = true;
    guard2_return_val = true;

    ev.id = EV_INIT;
    err = ufsm_process(&m, &ev);
    
    
    if (m.state_matrix[0] == &state_state1_composite_top &&
        m.state_matrix[1] == &state_state1_composite1 &&
        m.state_matrix[2] == &state_state1_composite2 &&
        err == false &&
        flag_guard1_called && flag_guard2_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL %s\n",m.state_matrix[0]->name);
        printf ("  Orth: %s\n",m.state_matrix[1]->name);
        test_ok = false;
    }
    
    printf (" o Sending EVENT2: ");

    
    ev.id = EV_EVENT2;
    err = ufsm_process(&m, &ev);
    
    if (m.state_matrix[0] == &state_state1_composite_top &&
        m.state_matrix[1] == &state_state2_composite &&
        m.state_matrix[2] == &state_state3_composite &&
        err == false &&
        flag_guard1_called && flag_guard2_called) {
        printf ("OK\n");
    } else {
        printf ("FAIL: \n");
        printf ("  Composite state: %s\n",m.state_matrix[0]->name);
        printf ("  Orth 0 : %s\n",m.state_matrix[1]->name);
        printf ("  Orth 1 : %s\n",m.state_matrix[2]->name);
        printf (" %i %i %i\n",err,flag_guard2_called, flag_guard2_called);
        test_ok = false;
    }
 

    printf ("  Composite state: %s\n",m.state_matrix[0]->name);
    printf ("  Orth 0 : %s\n",m.state_matrix[1]->name);
    printf ("  Orth 1 : %s\n",m.state_matrix[2]->name);
 
    printf (" o Sending EV_COMP_TEST: ");

    ev.id = EV_COMP_TEST;
    err = ufsm_process(&m, &ev);
 
    if (action_comp2_called && action_comp3_called) {
        printf ("OK\n");
    } else {
        printf ("FAILED %i %i %i\n",err,action_comp2_called, action_comp3_called);
        test_ok = false;
    }

    return test_ok;
}
