#include <stdio.h>
#include <assert.h>
#include <ufsm/ufsm.h>

enum events {
    EV_A,
    EV_B
};

static struct ufsm_state A;
static struct ufsm_region region1;
static struct ufsm_state simple_INIT;
static struct ufsm_state A, B;

static struct ufsm_trigger b_trigger =
{
    .name = "EV_B",
    .trigger = EV_B,
};

static struct ufsm_trigger a_trigger =
{
    .name = "EV_A",
    .trigger = EV_A,
};

static struct ufsm_transition simple_transition_B = 
{
    .trigger = &b_trigger,
    .source = &A,
    .dest = &B,
    .next = NULL
};


static struct ufsm_transition simple_transition_A = 
{
    .trigger = &a_trigger,
    .source = &B,
    .dest = &A,
    .next = NULL
};

static struct ufsm_transition simple_transition_INIT = 
{
    .source = &simple_INIT,
    .trigger = NULL,
    .dest = &A,
    .next = &simple_transition_A,
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

static struct ufsm_state B = 
{
    .index = 1,
    .name = "State B",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_A,
    .parent_region = &region1,
    .next = NULL,
};

static struct ufsm_state A = 
{
    .index = 2,
    .name = "State A",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_B,
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
    assert (m.r_data[m.region->index].current == &A);
    err = ufsm_process(&m, EV_B);
    assert (m.r_data[m.region->index].current == &B && err == UFSM_OK);
    err = ufsm_process(&m, EV_A);
    assert (m.r_data[m.region->index].current == &A && err == UFSM_OK);
    err = ufsm_process(&m, EV_B);
    assert (m.r_data[m.region->index].current == &B && err == UFSM_OK);

    return 0;
}
