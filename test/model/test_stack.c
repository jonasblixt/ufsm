#include <string.h>
#include <ufsm/model.h>
#include "../nala.h"
#include "common.h"

TEST(stack_create)
{
    int rc;
    struct ufsmm_stack *s = NULL;

    rc = ufsmm_stack_init(&s);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_stack_free(s);
    ASSERT_EQ(rc, UFSMM_OK);
}


TEST(stack_test1)
{
    int rc;
    struct ufsmm_stack *s = NULL;

    rc = ufsmm_stack_init(&s);
    ASSERT_EQ(rc, UFSMM_OK);

    int a = 1;

    rc = ufsmm_stack_push(s, &a);
    ASSERT_EQ(rc, UFSMM_OK);

    int *a_ptr = NULL;

    rc = ufsmm_stack_pop(s, (void *) &a_ptr);
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(a_ptr == &a);

    rc = ufsmm_stack_pop(s, (void *) &a_ptr);
    ASSERT_EQ(rc, -UFSMM_ERROR);

    rc = ufsmm_stack_free(s);
    ASSERT_EQ(rc, UFSMM_OK);
}
