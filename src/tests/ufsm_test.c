#include <stdio.h>
#include <ufsm.h>

#include "simple.h"
#include "orthogonal.h"



int main(void) {

    printf ("Running tests...\n");

    test_simple();
    test_orthogonal();

}

