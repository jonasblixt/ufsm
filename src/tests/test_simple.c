#include <assert.h>
#include <stdio.h>
#include <ufsm.h>
#include "common.h"

enum events
{
    EV_A,
    EV_B
};

static struct ufsm_state A;
static struct ufsm_region region1;

static struct ufsm_state simple_INIT = {.name = "Init",
                                        .kind = UFSM_STATE_INIT,
                                        .parent_region = &region1,
                                        .next = &A};

static struct ufsm_state B = {
    .name = "State B",
    .kind = UFSM_STATE_SIMPLE,
    .parent_region = &region1,
    .next = NULL,
};

static struct ufsm_state A = {
    .name = "State A",
    .kind = UFSM_STATE_SIMPLE,
    .parent_region = &region1,
    .next = &B,
};

static struct ufsm_transition simple_transition_B =
    {.name = "EV_B",
     .trigger = EV_B,
     .kind = UFSM_TRANSITION_EXTERNAL,
     .source = &A,
     .dest = &B,
     .next = NULL};

static struct ufsm_transition simple_transition_A =
    {.name = "EV_A",
     .trigger = EV_A,
     .kind = UFSM_TRANSITION_EXTERNAL,
     .source = &B,
     .dest = &A,
     .next = &simple_transition_B};

static struct ufsm_transition simple_transition_INIT = {
    .name = "Init",
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &simple_INIT,
    .trigger = UFSM_NO_TRIGGER,
    .dest = &A,
    .next = &simple_transition_A,
};

static struct ufsm_region region1 = {.state = &simple_INIT,
                                     .transition = &simple_transition_INIT,
                                     .next = NULL};

static struct ufsm_machine m = {
    .name = "Simple Test Machine",
    .region = &region1,
};

int main(void)
{
    uint32_t err;

    test_init(&m);

    err = ufsm_init_machine(&m);
    assert(err == UFSM_OK && "Initializing");
    assert(m.region->current == &A);
    err = ufsm_process(&m, EV_B);
    assert(m.region->current == &B && err == UFSM_OK);
    err = ufsm_process(&m, EV_A);
    assert(m.region->current == &A && err == UFSM_OK);
    err = ufsm_process(&m, EV_B);
    assert(m.region->current == &B && err == UFSM_OK);
    err = ufsm_process(&m, EV_B);
    assert(m.region->current == &B && err == UFSM_ERROR_EVENT_NOT_PROCESSED);

    return 0;
}
