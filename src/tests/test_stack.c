#include <ufsm.h>
#include <string.h>
#include "common.h"

#define STACK_SIZE 4


int main(void)
{
    void *stack_data[STACK_SIZE];
    struct ufsm_stack s;
    const char *test_data = "The Quick Brown Fox Jumps Over The Lazy Dog";

    char *popped_string = NULL;

    assert (ufsm_stack_init(&s, STACK_SIZE, stack_data) == UFSM_OK); 

    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_ERROR_STACK_UNDERFLOW);

    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_OK);

    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_OK);

    assert (strcmp(popped_string, test_data) == 0);

    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_OK);
    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_OK);
    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_OK);
    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_OK);
    assert (ufsm_stack_push(&s, (void *) test_data) == UFSM_ERROR_STACK_OVERFLOW);

    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_OK);
    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_OK);
    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_OK);
    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_OK);
    assert (ufsm_stack_pop(&s, (void **) &popped_string) == UFSM_ERROR_STACK_UNDERFLOW);

    return 0;
}
