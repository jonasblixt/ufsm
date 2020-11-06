#include <stdio.h>
#include <assert.h>
#include <ufsm.h>

enum events {
    eTestEvent,
};

static struct ufsm_region region1;
static struct ufsm_state simple_INIT;
static struct ufsm_state A, B, C, D;

static struct ufsm_trigger test_trigger =
{
    .name = "eTestEvent",
    .trigger = eTestEvent,
};

static struct ufsm_transition simple_transition_A = 
{
    .trigger = NULL,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &A,
    .dest = &B,
    .next = NULL
};


static struct ufsm_transition simple_transition_B = 
{
    .trigger = &test_trigger,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &B,
    .dest = &C,
    .next = NULL,
};

static struct ufsm_transition simple_transition_C = 
{
    .trigger = NULL,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &C,
    .dest = &D,
    .next = NULL,
};

static struct ufsm_transition simple_transition_INIT = 
{
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &simple_INIT,
    .trigger = NULL,
    .dest = &A,
    .next = NULL,
};

static struct ufsm_state simple_INIT =
{
    .index = 0,
    .name = "Init",
    .kind = UFSM_STATE_INIT,
    .parent_region = &region1,
    .transition = &simple_transition_INIT,
    .next = &A
};

static struct ufsm_state D = 
{
    .index = 1,
    .name = "State D",
    .kind = UFSM_STATE_SIMPLE,
    .transition = NULL,
    .parent_region = &region1,
    .next = NULL,
};

static struct ufsm_state C = 
{
    .index = 2,
    .name = "State C",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_C,
    .parent_region = &region1,
    .next = &D,
};

static struct ufsm_state B = 
{
    .index = 3,
    .name = "State B",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_B,
    .parent_region = &region1,
    .next = &C,
};

static struct ufsm_state A = 
{
    .index = 4,
    .name = "State A",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_A,
    .parent_region = &region1,
    .next = &B,
};

static struct ufsm_region region1 = 
{
    .index = 0,
    .state = &simple_INIT,
    .next = NULL
};

void *stack1[UFSM_STACK_SIZE];
void *stack2[UFSM_STACK_SIZE];
struct ufsm_region_data r_data[10];
struct ufsm_state_data s_data[10];

static struct ufsm_machine m  = 
{
    .name = "Simple Test Machine",
    .region = &region1,
    .r_data = r_data,
    .s_data = s_data,
    .no_of_regions = 10,
    .no_of_states = 10,
};

int main(void) {
    uint32_t err;

    ufsm_stack_init(&m.stack, UFSM_STACK_SIZE, stack1);
    ufsm_stack_init(&m.stack2, UFSM_STACK_SIZE, stack2);
    ufsm_debug_machine(&m);

    err = ufsm_init_machine(&m, NULL);

    assert (err == UFSM_OK && "Initializing");
    assert (m.r_data[m.region->index].current == &B);

    err = ufsm_process(&m, eTestEvent);
    assert(err == UFSM_OK);
    assert (m.r_data[m.region->index].current == &D);
    return 0;
}
