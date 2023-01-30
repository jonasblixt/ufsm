#include <stdio.h>
#include <stdbool.h>
#include <string.h>
#include "test_helper.h"

static const char *test_vec[128];
static unsigned int test_vec_count;

void ufsm_test_reset(void)
{
    test_vec_count = 0;
}

void ufsm_test_rec(const char *func_name)
{
    printf("%s\n", func_name);
    test_vec[test_vec_count++] = func_name;
}

bool ufsm_test_check(const char *expected[])
{
    bool test_failed = false;
    size_t expected_count = 0;

    for (; expected[expected_count] != NULL; expected_count++) {
    }

    size_t max_count = expected_count > test_vec_count?expected_count:test_vec_count;

    for (unsigned int i = 0; i < max_count; i++) {
        const char *exp = "?";
        const char *act = "?";

        if (i < test_vec_count)
            act = test_vec[i];
        if (i < expected_count)
            exp = expected[i];

        if (strcmp(act, exp) != 0) {
            test_failed = true;
            break;
        }
    }

    if (test_failed) {
        printf("Test failure:\n");
        printf("Index    Actual   Expected\n");
        printf("-----    ------   --------\n");

        for (unsigned int i = 0; i < max_count; i++) {
            const char *exp = "<NULL>";
            const char *act = "<NULL>";

            if (i < test_vec_count)
                act = test_vec[i];
            if (i < expected_count)
                exp = expected[i];

            if (strcmp(act, exp) != 0) {
                printf("%4i %10s %10s !!\n", i, act, exp);
            } else {
                printf("%4i %10s %10s\n", i, act, exp);
            }

        }
        return false;
    }

    return true;
}
