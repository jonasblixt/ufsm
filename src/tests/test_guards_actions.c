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

static bool guard1_f(void) {
    flag_guard1_called = true;
    return true;
}

static bool guard2_f(void) {
    flag_guard2_called = true;
    return guard2_ret_val;
}

static void action1_f(void) {
    flag_action1_called = true;
}

static struct ufsm_state A;

static struct ufsm_state simple_INIT =
{
    .name = "Init",
    .kind = UFSM_STATE_INIT,
    .next = &A
};

static struct ufsm_state B = 
{
    .name = "State B",
    .kind = UFSM_STATE_SIMPLE,
    .next = NULL,
};

static struct ufsm_state A = 
{
    .name = "State A",
    .kind = UFSM_STATE_SIMPLE,
    .next = &B,
};

static struct ufsm_guard guard2;

static struct ufsm_guard guard1 = 
{
    .f = &guard1_f,
    .next = &guard2,
};

static struct ufsm_guard guard2 = 
{
    .f = &guard2_f,
    .next = NULL,
};

static struct ufsm_action action1 = 
{
    .f = &action1_f,
    .next = NULL,
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
    .guard = &guard1,
    .action = &action1,
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

static struct ufsm_machine m  = 
{
    .name = "Simple Test Machine",
    .region = &region1,
};

int main(int argc, char **argv)
{
    uint32_t err;


    reset_test_flags();
    err = ufsm_init(&m);
    assert (err == UFSM_OK && "Initializing");
    assert (m.region->current == &A);
    assert (flag_guard1_called == false);
    assert (flag_guard2_called == false);
    assert (flag_action1_called == false);

    reset_test_flags();
    err = ufsm_process(&m, EV_B);
    assert (m.region->current == &B && err == UFSM_OK);

    reset_test_flags();
    err = ufsm_process(&m, EV_A);
    assert (m.region->current == &A && err == UFSM_OK);
    assert (flag_guard1_called);
    assert (flag_guard2_called);
    assert (flag_action1_called);


    reset_test_flags();
    err = ufsm_process(&m, EV_B);
    assert (m.region->current == &B && err == UFSM_OK);

    reset_test_flags();
    guard2_ret_val = false;
    err = ufsm_process(&m, EV_A);
    assert (m.region->current == &B && err == UFSM_OK);
    assert (flag_guard1_called);
    assert (flag_guard2_called);
    assert (flag_action1_called == false);



    return 0;
}
