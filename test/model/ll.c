#include <ufsm/model.h>
#include "../nala.h"


TEST(create_free_ll)
{
    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(create_simple_list)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n1);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n2);
    ASSERT_EQ(ll->first->next, n2);
    ASSERT_EQ(ll->last->prev, n1);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n3);
    ASSERT_EQ(ll->last->prev, n2);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(test_pop)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n_out = NULL;
    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n3);
    ASSERT_EQ(ll->last, n2);
    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(ll->first, n1);
    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n1);
    ASSERT_EQ(ll->last, NULL);
    ASSERT_EQ(ll->first, NULL);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(test_pop_non_stop)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n_out = NULL;
    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n3);
    ASSERT_EQ(ll->last, n2);
    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(ll->first, n1);
    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n_out, n1);
    ASSERT_EQ(ll->last, NULL);
    ASSERT_EQ(ll->first, NULL);

    rc = ufsmm_ll_pop(ll, &n_out);
    ASSERT_EQ(rc, -1);
    ASSERT_EQ(n_out, NULL);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(test_pop2)
{
    const char *n1_str = "N1";
    const char *n2_str = "N2";
    const char *n3_str = "N3";
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node((void *) n1_str);
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node((void *) n2_str);
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node((void *) n3_str);
    const char *data_out = NULL;
    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_pop2(ll, (void **) &data_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(data_out, n3_str);
    rc = ufsmm_ll_pop2(ll, (void **) &data_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(data_out, n2_str);
    rc = ufsmm_ll_pop2(ll, (void **) &data_out);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(data_out, n1_str);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(test_prepend)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n1);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n2);
    ASSERT_EQ(ll->first->next, n2);
    ASSERT_EQ(ll->last->prev, n1);
    rc = ufsmm_ll_prepend(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n3);
    ASSERT_EQ(ll->last, n2);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(test_find)
{
    const char *n1_str = "N1";
    const char *n2_str = "N2";
    const char *n3_str = "N3";
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node((void *) n1_str);
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node((void *) n2_str);
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node((void *) n3_str);
    struct ufsmm_ll_node *result = NULL;
    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_prepend(ll, n3);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_find(ll, (void *) n1_str, &result);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(result, n1);
    rc = ufsmm_ll_find(ll, (void *) n2_str, &result);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(result, n2);
    rc = ufsmm_ll_find(ll, (void *) n3_str, &result);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(result, n3);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_up)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    printf("move_up 1\n");
    /* After this operation the order should be: n1, n3, n2 */
    rc = ufsmm_ll_move_up(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n2);
    ASSERT_EQ(n1->next, n3);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n2->next, NULL);
    ASSERT_EQ(n2->prev, n3);
    ASSERT_EQ(n3->prev, n1);
    ASSERT_EQ(n3->next, n2);

    printf("move_up 2\n");
    /* After this operation the order should be: n3, n1, n2 */
    rc = ufsmm_ll_move_up(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n3);
    ASSERT_EQ(ll->last, n2);
    ASSERT_EQ(n3->prev, NULL);
    ASSERT_EQ(n3->next, n1);
    ASSERT_EQ(n1->prev, n3);
    ASSERT_EQ(n1->next, n2);
    ASSERT_EQ(n2->prev, n1);
    ASSERT_EQ(n2->next, NULL);

    printf("move_up 3\n");
    /* After this operation the order should be: n3, n1, n2 */
    rc = ufsmm_ll_move_up(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n3);
    ASSERT_EQ(ll->last, n2);
    ASSERT_EQ(n3->prev, NULL);
    ASSERT_EQ(n3->next, n1);
    ASSERT_EQ(n1->prev, n3);
    ASSERT_EQ(n1->next, n2);
    ASSERT_EQ(n2->prev, n1);
    ASSERT_EQ(n2->next, NULL);

    printf("move_up 4\n");
    /* After this operation the order should be: n3, n2, n1 */
    rc = ufsmm_ll_move_up(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n3);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n3->prev, NULL);
    ASSERT_EQ(n3->next, n2);

    ASSERT_EQ(n2->prev, n3);
    ASSERT_EQ(n2->next, n1);

    ASSERT_EQ(n1->prev, n2);
    ASSERT_EQ(n1->next, NULL);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_up_two_nodes)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);

    printf("move_up 1\n");
    /* After this operation the order should be: n2, n1 */
    rc = ufsmm_ll_move_up(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n2);

    printf("move_up 2\n");
    /* After this operation the order should be: n2, n1 */
    rc = ufsmm_ll_move_up(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n2);
    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_up_one_node)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);

    rc = ufsmm_ll_move_up(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n1->next, NULL);

    ufsmm_ll_free_node(n1);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_down)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    printf("move_down 1\n");
    /* After this operation the order should be: n2, n1, n3 */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n3);

    ASSERT_EQ(n2->next, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, n3);
    ASSERT_EQ(n1->prev, n2);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n3->prev, n1);

    printf("move_down 2\n");
    /* After this operation the order should be: n2, n3, n1 */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);

    ASSERT_EQ(n2->next, n3);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n3->next, n1);
    ASSERT_EQ(n3->prev, n2);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n3);

    printf("move_down 3\n");
    /* Moving n1 down once more should yield the same result as above */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);

    ASSERT_EQ(n2->next, n3);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n3->next, n1);
    ASSERT_EQ(n3->prev, n2);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n3);

    printf("move_down 4\n");
    /* After this operation the order should be: n2, n1, n3 */
    rc = ufsmm_ll_move_down(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n3);

    ASSERT_EQ(n2->next, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, n3);
    ASSERT_EQ(n1->prev, n2);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n3->prev, n1);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_down_two_nodes)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);

    printf("move_down 1\n");
    /* After this operation the order should be: n2, n1 */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n2);

    printf("move_down 2\n");
    /* After this operation the order should be: n2, n1 */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n1->next, NULL);
    ASSERT_EQ(n1->prev, n2);
    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(move_down_one_node)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");

    int rc;
    struct ufsmm_ll *ll;
    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);

    printf("move_down 1\n");
    /* After this operation the order should be: n1 */
    rc = ufsmm_ll_move_down(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n1);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n1->next, NULL);

    ufsmm_ll_free_node(n1);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(remove_first_and_last)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);


    /* Remove first node */
    rc = ufsmm_ll_remove(ll, n1);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(n2->prev, NULL);

    /* Remove last node */
    rc = ufsmm_ll_remove(ll, n3);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n2);
    ASSERT_EQ(n2->prev, NULL);
    ASSERT_EQ(n2->next, NULL);
    ASSERT_EQ(ll->last, n2);

    ufsmm_ll_free_node(n2);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(remove_middle)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");

    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);


    /* Remove middle node */
    rc = ufsmm_ll_remove(ll, n2);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n3);
    ASSERT_EQ(n3->prev, n1);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n1->next, n3);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n3);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(insert_before)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n4 = ufsmm_ll_init_node("N4");


    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    /* After this operation the order should be: n1, n4, n2, n3 */
    rc = ufsmm_ll_insert_before(ll, n2, n4);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n1->next, n4);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n4->next, n2);
    ASSERT_EQ(n4->prev, n1);
    ASSERT_EQ(n2->next, n3);
    ASSERT_EQ(n2->prev, n4);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n3->prev, n2);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);
    ufsmm_ll_free_node(n4);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(insert_before_first)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n4 = ufsmm_ll_init_node("N4");


    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    /* After this operation the order should be: n4, n1, n2, n3 */
    rc = ufsmm_ll_insert_before(ll, n1, n4);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n4);
    ASSERT_EQ(n4->next, n1);
    ASSERT_EQ(n4->prev, NULL);
    ASSERT_EQ(n1->next, n2);
    ASSERT_EQ(n1->prev, n4);
    ASSERT_EQ(n2->next, n3);
    ASSERT_EQ(n2->prev, n1);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n3->prev, n2);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);
    ufsmm_ll_free_node(n4);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(insert_after)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n4 = ufsmm_ll_init_node("N4");


    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    /* After this operation the order should be: n1, n2, n4, n3 */
    rc = ufsmm_ll_insert_after(ll, n2, n4);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(ll->first, n1);
    ASSERT_EQ(ll->last, n3);
    ASSERT_EQ(n1->next, n2);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n2->next, n4);
    ASSERT_EQ(n2->prev, n1);
    ASSERT_EQ(n4->next, n3);
    ASSERT_EQ(n4->prev, n2);
    ASSERT_EQ(n3->next, NULL);
    ASSERT_EQ(n3->prev, n4);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);
    ufsmm_ll_free_node(n4);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}

TEST(insert_after_last)
{
    struct ufsmm_ll_node *n1 = ufsmm_ll_init_node("N1");
    struct ufsmm_ll_node *n2 = ufsmm_ll_init_node("N2");
    struct ufsmm_ll_node *n3 = ufsmm_ll_init_node("N3");
    struct ufsmm_ll_node *n4 = ufsmm_ll_init_node("N4");


    int rc;
    struct ufsmm_ll *ll;

    rc = ufsmm_ll_init(&ll);
    ASSERT_EQ(rc, 0);


    rc = ufsmm_ll_append(ll, n1);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n2);
    ASSERT_EQ(rc, 0);
    rc = ufsmm_ll_append(ll, n3);
    ASSERT_EQ(rc, 0);

    /* After this operation the order should be: n1, n2, n3, n4 */
    rc = ufsmm_ll_insert_after(ll, n3, n4);
    ASSERT_EQ(rc, 0);
    ASSERT_EQ(n1->next, n2);
    ASSERT_EQ(n1->prev, NULL);
    ASSERT_EQ(n2->next, n3);
    ASSERT_EQ(n2->prev, n1);
    ASSERT_EQ(n3->next, n4);
    ASSERT_EQ(n3->prev, n2);
    ASSERT_EQ(n4->next, NULL);
    ASSERT_EQ(n4->prev, n3);
    ASSERT_EQ(ll->last, n4);

    ufsmm_ll_free_node(n1);
    ufsmm_ll_free_node(n2);
    ufsmm_ll_free_node(n3);
    ufsmm_ll_free_node(n4);

    rc = ufsmm_ll_free(ll);
    ASSERT_EQ(rc, 0);
}
