#include <string.h>
#include <sotc/sotc.h>
#include <sotc/stack.h>
#include "nala.h"
#include "common.h"

TEST(stack_create)
{
    int rc;
    struct sotc_stack *s = NULL;

    rc = sotc_stack_init(&s, 1024);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_stack_free(s);
    ASSERT_EQ(rc, SOTC_OK);
}


TEST(stack_test1)
{
    int rc;
    struct sotc_stack *s = NULL;

    rc = sotc_stack_init(&s, 1);
    ASSERT_EQ(rc, SOTC_OK);

    int a = 1;

    rc = sotc_stack_push(s, &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_stack_push(s, &a);
    ASSERT_EQ(rc, -SOTC_ERROR);

    int *a_ptr = NULL;

    rc = sotc_stack_pop(s, (void *) &a_ptr);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(a_ptr == &a);

    rc = sotc_stack_pop(s, (void *) &a_ptr);
    ASSERT_EQ(rc, -SOTC_ERROR);

    rc = sotc_stack_free(s);
    ASSERT_EQ(rc, SOTC_OK);
}
