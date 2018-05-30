#include <stdio.h>
#include <assert.h>
#include <ufsm.h>
#include "common.h"

enum events {
    EV_A,
    EV_B,
    EV_C,
    EV_D,
};

static struct ufsm_state A;
static struct ufsm_region sub_region;
static struct ufsm_region region1;

static struct ufsm_state simple_INIT =
{
    .name = "Init",
    .kind = UFSM_STATE_INIT,
    .parent_region = &region1,
    .next = &A
};

static struct ufsm_state B = 
{
    .name = "State B",
    .kind = UFSM_STATE_SIMPLE,
    .parent_region = &region1,
    .next = NULL,
};

static struct ufsm_state A = 
{
    .name = "State A",
    .kind = UFSM_STATE_SIMPLE,
    .region = &sub_region,
    .parent_region = &region1,
    .next = &B,
};

static struct ufsm_transition simple_transition_B = 
{
    .name = "EV_B",
    .trigger = EV_B,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &A,
    .dest = &B,
    .next = NULL
};


static struct ufsm_transition simple_transition_A = 
{
    .name = "EV_A",
    .trigger = EV_A,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &B,
    .dest = &A,
    .next = &simple_transition_B
};

static struct ufsm_transition simple_transition_INIT = 
{
    .name = "Init",
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &simple_INIT,
    .trigger = UFSM_NO_TRIGGER,
    .dest = &A,
    .next = &simple_transition_A,
};

static struct ufsm_region region1 = 
{
    .state = &simple_INIT,
    .transition = &simple_transition_INIT,
    .next = NULL
};


/* Substates in A */


static struct ufsm_state C;
static struct ufsm_state D;

static struct ufsm_state simple_sub_INIT =
{
    .name = "Substate Init",
    .kind = UFSM_STATE_INIT,
    .parent_region = &sub_region,
    .next = &C
};

static struct ufsm_state C = 
{
    .name = "State C",
    .kind = UFSM_STATE_SIMPLE,
    .parent_region = &sub_region,
    .next = &D,
};

static struct ufsm_state D = 
{
    .name = "State D",
    .kind = UFSM_STATE_SIMPLE,
    .parent_region = &sub_region,
    .next = NULL,
};

static struct ufsm_transition simple_transition_D;
static struct ufsm_transition simple_transition_sub_INIT;

static struct ufsm_transition simple_transition_C = 
{
    .name = "EV_C",
    .trigger = EV_C,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &D,
    .dest = &C,
    .next = &simple_transition_D,
};


static struct ufsm_transition simple_transition_D = 
{
    .name = "EV_D",
    .trigger = EV_D,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &C,
    .dest = &D,
    .next = &simple_transition_sub_INIT,
};

static struct ufsm_transition simple_transition_sub_INIT = 
{
    .name = "Init sub",
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &simple_sub_INIT,
    .trigger = UFSM_NO_TRIGGER,
    .dest = &C,
    .next = NULL,
};



static struct ufsm_region sub_region = 
{
    .state = &simple_sub_INIT,
    .transition = &simple_transition_C,
    .next = NULL
};

static struct ufsm_machine m  = 
{
    .name = "Simple Substate Test Machine",
    .region = &region1,
};

int main(int argc, char **argv)
{
    uint32_t err;
    test_init(&m);

    err = ufsm_init_machine(&m);
    assert (err == UFSM_OK && "Initializing");
    assert (m.region->current == &A && m.region->current->region->current == &C);
    err = ufsm_process(&m, EV_B);
    assert (m.region->current == &B && err == UFSM_OK);
    assert (m.region->current->region == NULL);

    err = ufsm_process(&m, EV_A);
    assert (m.region->current == &A && err == UFSM_OK);
    assert (m.region->current->region->current == &C);


    err = ufsm_process(&m, EV_D);
    assert (m.region->current == &A && err == UFSM_OK);
    assert (m.region->current->region->current == &D);

    err = ufsm_process(&m, EV_B);
    assert (m.region->current == &B && err == UFSM_OK);
    assert (m.region->current->region == NULL);

    err = ufsm_process(&m, EV_A);
    assert (m.region->current == &A && err == UFSM_OK);
    assert (m.region->current->region->current == &C);


    return 0;
}
