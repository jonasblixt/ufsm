#include <stdio.h>
#include <ufsm.h>
#include <assert.h>

#include "simple.h"
//#include "orthogonal.h"
#include "simple_substate.h"



int main(void) {

    printf ("Running tests...\n");

    assert(test_simple());
    //test_orthogonal();
    assert(test_simple_substate());

}

