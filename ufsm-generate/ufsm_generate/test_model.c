#include <stdio.h>
#include <assert.h>
#include <string.h>
#include <stdlib.h>
#include "output.h"

#define UT(x) (struct ufsm_test *)(x)

struct ufsm_test_element {
    const char *identifier;
    struct ufsm_test_element *next;
};

struct ufsm_test {
    struct ufsm_test_element *first, *last;
};

void ufsm_test_reset(struct ufsm_test *test)
{
    if (test == NULL)
        return;
    struct ufsm_test_element *ele = test->first;
    struct ufsm_test_element *tmp;
    if (ele == NULL)
        return;

    do {
        tmp = ele;
        ele = ele->next;
        free(tmp);
    } while (ele != NULL);

    test->first = NULL;
    test->last = NULL;
}

void ufsm_test_append(struct ufsm_test *test, const char *id)
{
    struct ufsm_test_element *ele = calloc(1, sizeof(struct ufsm_test_element));
    printf("add %s\n", id);
    ele->identifier = id;
    if (test->first == NULL) {
        test->first = ele;
        test->last = ele;
    } else {
        test->last->next = ele;
        test->last = ele;
    }
}

void ufsm_test_assert(struct ufsm_test *test, const char **strs_to_assert) 
{
    const char **s = strs_to_assert;
    struct ufsm_test_element *ele;

    ele = test->first;
    do {
        assert(ele != NULL && "Expected more elements");
        assert(*s != NULL && "Expected test string");
        printf("Test %s %s\n", *s, ele->identifier);
        assert(strcmp(*s, ele->identifier) == 0 && "Element mismatch");
        ele = ele->next;
    } while (*(s++) != NULL && ele != NULL);
    assert(ele == NULL && "There were more elements to test");
    assert(*s == NULL && "We expected more elements");
}

void eA(void *user)
{
    printf("eA\n");
}

void xA(void *user)
{
    printf("xA\n");
}

void eC1(void *user)
{
    printf("eC1\n");
}

void xC1(void *user)
{
    printf("xC1\n");
}

void eC11(void *user)
{
    printf("eC11\n");
}

void xC11(void *user)
{
    printf("xC11\n");
}

void eC12(void *user)
{
    printf("eC12\n");
}

void xC12(void *user)
{
    printf("xC12\n");
}

void eB(void *user)
{
    printf("eB\n");
}

void xB(void *user)
{
    printf("xB\n");
}

void eC2(void *user)
{
    printf("eC2\n");
}

void xC2(void *user)
{
    printf("xC2\n");
}

void eD2(void *user)
{
    printf("eD2\n");
}

void xD2(void *user)
{
    printf("xD2\n");
}

void eD1(void *user)
{
    printf("eD1\n");
}

void xD1(void *user)
{
    ufsm_test_append(UT(user), "xD1");
}

void eD11(void *user)
{
    printf("eD11\n");
}

void xD11(void *user)
{
    printf("xD11\n");
}

void eD12(void *user)
{
    printf("eD12\n");
}

void xD12(void *user)
{
    ufsm_test_append(UT(user), "xD12");
}

void eE1(void *user)
{
    printf("eE1\n");
}

void xE1(void *user)
{
    ufsm_test_append(UT(user), "xE1");
}

void eE11(void *user)
{
    printf("eE11\n");
}

void xE11(void *user)
{
    printf("xE11\n");
}

void eE12(void *user)
{
    printf("eE12\n");
}

void xE12(void *user)
{
    ufsm_test_append(UT(user), "xE12");
}

void o2(void *user)
{
    printf("o2\n");
}

void o1(void *user)
{
    printf("o1\n");
}

int main(int argc, char **argv)
{
    struct ufsm_machine m = {0};
    struct ufsm_test test = {0};
    m.user = &test;
    printf("RESET\n");
    ufsm_process(&m, UFSM_RESET);
    printf("Reset done\n");
    printf("-> e4\n");
    ufsm_process(&m, e4);
    printf("-> e2\n");
    ufsm_process(&m, e2);
    printf("-> e1\n");
    ufsm_process(&m, e1);

    printf("-> e7\n");
    ufsm_process(&m, e7);

    printf("-> e1\n");
    ufsm_test_reset(&test);
    ufsm_process(&m, e1);
    const char *test1[] = {"xD12",
                          "xE12",
                          "xD1",
                          "xE1",
                          NULL};
    ufsm_test_assert(&test, test1);

}
