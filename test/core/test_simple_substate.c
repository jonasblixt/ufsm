#include <stdio.h>
#include <assert.h>
#include <ufsm/core/ufsm.h>

enum events {
    EV_A,
    EV_B,
    EV_C,
    EV_D,
};

static struct ufsm_state A, B, simple_INIT;
static struct ufsm_region sub_region;
static struct ufsm_region region1;


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


static struct ufsm_trigger c_trigger =
{
    .name = "EV_C",
    .trigger = EV_C,
};

static struct ufsm_trigger d_trigger =
{
    .name = "EV_D",
    .trigger = EV_D,
};

static struct ufsm_transition simple_transition_B = 
{
    .trigger = &b_trigger,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &A,
    .dest = &B,
    .next = NULL
};


static struct ufsm_transition simple_transition_A = 
{
    .trigger = &a_trigger,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &B,
    .dest = &A,
    .next = NULL
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
    .transition = &simple_transition_INIT,
    .parent_region = &region1,
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
    .region = &sub_region,
    .parent_region = &region1,
    .next = &B,
};



static struct ufsm_region region1 = 
{
    .index = 0,
    .name = "Root region",
    .state = &simple_INIT,
    .next = NULL
};


/* Substates in A */


static struct ufsm_state C;
static struct ufsm_state D;
static struct ufsm_state simple_sub_INIT;

static struct ufsm_transition simple_transition_D;
static struct ufsm_transition simple_transition_sub_INIT;

static struct ufsm_transition simple_transition_C = 
{
    .trigger = &c_trigger,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &D,
    .dest = &C,
    .next = &simple_transition_D,
};


static struct ufsm_transition simple_transition_D = 
{
    .trigger = &d_trigger,
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &C,
    .dest = &D,
    .next = NULL,
};

static struct ufsm_transition simple_transition_sub_INIT = 
{
    .kind = UFSM_TRANSITION_EXTERNAL,
    .source = &simple_sub_INIT,
    .trigger = NULL,
    .dest = &C,
    .next = NULL,
};

static struct ufsm_state simple_sub_INIT =
{
    .index = 3,
    .name = "Substate Init",
    .kind = UFSM_STATE_INIT,
    .transition = &simple_transition_sub_INIT,
    .parent_region = &sub_region,
    .next = &C
};

static struct ufsm_state C = 
{
    .index = 4,
    .name = "State C",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_D,
    .parent_region = &sub_region,
    .next = &D,
};

static struct ufsm_state D = 
{
    .index = 5,
    .name = "State D",
    .kind = UFSM_STATE_SIMPLE,
    .transition = &simple_transition_C,
    .parent_region = &sub_region,
    .next = NULL,
};




static struct ufsm_region sub_region = 
{
    .index = 1,
    .name ="Sub region",
    .state = &simple_sub_INIT,
    .next = NULL
};

void *stack1[UFSM_STACK_SIZE];
void *stack2[UFSM_STACK_SIZE];

struct ufsm_region_data r_data[10];
struct ufsm_state_data s_data[10];
static struct ufsm_machine m  = 
{
    .name = "Simple Substate Test Machine",
    .region = &region1,
    .r_data = r_data,
    .s_data = s_data,
    .no_of_regions = 10,
    .no_of_states = 10,
};

int main(void)
{
    int err;
    const struct ufsm_state *c, *c2;

    ufsm_stack_init(&m.stack, UFSM_STACK_SIZE, stack1);
    ufsm_stack_init(&m.stack2, UFSM_STACK_SIZE, stack2);
    ufsm_debug_machine(&m);

    err = ufsm_init_machine(&m, NULL);
    assert (err == UFSM_OK && "Initializing");
    c = m.r_data[m.region->index].current;

    assert (c == &A);
    c2 = m.r_data[c->region->index].current;
    assert (c2 == &C);
    err = ufsm_process(&m, EV_B);

    c = m.r_data[m.region->index].current;
    assert (c == &B && err == UFSM_OK);
    assert (c->region == NULL);

    err = ufsm_process(&m, EV_A);

    c = m.r_data[m.region->index].current;
    c2 = m.r_data[c->region->index].current;
    assert (c == &A && err == UFSM_OK);
    assert (c2 == &C);


    err = ufsm_process(&m, EV_D);

    c = m.r_data[m.region->index].current;
    c2 = m.r_data[c->region->index].current;
    assert (c == &A && err == UFSM_OK);
    assert (c2 == &D);

    err = ufsm_process(&m, EV_B);

    c = m.r_data[m.region->index].current;
    assert (c == &B && err == UFSM_OK);
    assert (c->region == NULL);

    err = ufsm_process(&m, EV_A);

    c = m.r_data[m.region->index].current;
    c2 = m.r_data[c->region->index].current;
    assert (c == &A && err == UFSM_OK);
    assert (c2 == &C);


    return 0;
}
