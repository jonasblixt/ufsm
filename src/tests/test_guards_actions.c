#include <stdio.h>
#include <assert.h>
#include <ufsm.h>

enum events {
    EV_A,
    EV_B
};


static bool flag_guard1_called = false;
static bool flag_guard2_called = false;
static bool flag_action1_called = false;
static bool guard2_ret_val = true;


static void reset_test_flags(void) {
    flag_guard1_called = false;
    flag_guard2_called = false;
    flag_action1_called = false;
    guard2_ret_val = true;
}

static bool guard1_f(void *ctx) {
    flag_guard1_called = true;
    return true;
}

static bool guard2_f(void *ctx) {
    flag_guard2_called = true;
    return guard2_ret_val;
}

static void action1_f(void *ctx) {
    flag_action1_called = true;
}

static struct ufsm_state A, B, simple_INIT;
static struct ufsm_region region1;
static struct ufsm_guard guard2;

static struct ufsm_guard guard1 = 
{
    .f = &guard1_f,
    .name = "guard1_f",
    .next = &guard2,
};

static struct ufsm_guard guard2 = 
{
    .f = &guard2_f,
    .name = "guard2_f",
    .next = NULL,
};

static struct ufsm_action action1 = 
{
    .f = &action1_f,
    .name = "action1_f",
    .next = NULL,
};

static struct ufsm_trigger a_trigger =
{
    .name = "EV_A",
    .trigger = EV_A,
};

static struct ufsm_trigger b_trigger =
{
    .name = "EV_B",
    .trigger = EV_B,
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
    .guard = &guard1,
    .action = &action1,
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
    .stack_data = stack1,
    .stack_data2 = stack2,
    .r_data = r_data,
    .s_data = s_data,
    .no_of_regions = 10,
    .no_of_states = 10,
};

int main(void)
{
    int err;
    struct ufsm_state *c;

    reset_test_flags();
    ufsm_debug_machine(&m);
    err = ufsm_init_machine(&m, NULL);
    assert (err == UFSM_OK && "Initializing");

    c = m.r_data[m.region->index].current;
    assert (c == &A);
    assert (flag_guard1_called == false);
    assert (flag_guard2_called == false);
    assert (flag_action1_called == false);

    reset_test_flags();
    err = ufsm_process(&m, EV_B);

    c = m.r_data[m.region->index].current;
    assert (c == &B && err == UFSM_OK);

    reset_test_flags();
    err = ufsm_process(&m, EV_A);

    c = m.r_data[m.region->index].current;
    assert (c == &A && err == UFSM_OK);
    assert (flag_guard1_called);
    assert (flag_guard2_called);
    assert (flag_action1_called);


    reset_test_flags();
    err = ufsm_process(&m, EV_B);

    c = m.r_data[m.region->index].current;
    assert (c == &B && err == UFSM_OK);

    reset_test_flags();
    guard2_ret_val = false;
    err = ufsm_process(&m, EV_A);

    c = m.r_data[m.region->index].current;
    assert (c == &B);
    assert (err == UFSM_OK);
    assert (flag_guard1_called);
    assert (flag_guard2_called);
    assert (flag_action1_called == false);



    return 0;
}
