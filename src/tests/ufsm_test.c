#include <stdio.h>
#include <ufsm.h>
#include <assert.h>

#include "simple.h"
#include "simple_substate.h"
#include "test_guards_actions.h"


int main(void) {

    printf ("Running tests...\n");

    assert(test_simple());
    assert(test_simple_substate());
    assert(test_guards_actions());


    printf ("\n\n *** ALL TESTS PASSED ***\n");
}

