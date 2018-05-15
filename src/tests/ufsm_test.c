#include <stdio.h>
#include <ufsm.h>

#include "simple.h"
#include "orthogonal.h"
#include "simple_substate.h"



int main(void) {

    printf ("Running tests...\n");

    test_simple();
    //test_orthogonal();
    test_simple_substate();

}

