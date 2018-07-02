#ifndef UFSM_TEST_COMMON
#define UFSM_TEST_COMMON

#include <assert.h>
#include <ufsm.h>

void debug_transition(struct ufsm_transition* t);
void debug_enter_region(struct ufsm_region* r);
void debug_leave_region(struct ufsm_region* r);
void debug_event(event_t ev);
void debug_action(struct ufsm_action* a);
void debug_guard(struct ufsm_guard* g, bool result);
void debug_enter_state(struct ufsm_state* s);
void debug_exit_state(struct ufsm_state* s);

void test_process(struct ufsm_machine* m, event_t ev);
void test_init(struct ufsm_machine* m);

#endif
