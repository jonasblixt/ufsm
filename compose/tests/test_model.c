#include <string.h>
#include <ufsm/model.h>
#include <json.h>
#include "../nala.h"
#include "common.h"

TEST(load_model)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load(UFSMM_TEST_SRC"test1.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(load_empty_root)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load(UFSMM_TEST_SRC"test_empty_root.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Model load %i\n", rc);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(create_model)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");
    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(load_model2)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load(UFSMM_TEST_SRC"test2.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(write_model)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b, *c;
    struct ufsmm_region *r1, *r2;
    struct ufsmm_state *c1, *c2, *c3;
    struct ufsmm_state *c31, *c32, *c33;

    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    b = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(b, "B");
    rc = ufsmm_region_append_state(model->root, b);
    ASSERT_EQ(rc, UFSMM_OK);

    c = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c, "C");
    rc = ufsmm_region_append_state(model->root, c);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add region in composit state C */
    rc = ufsmm_add_region(c, false, &r1);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_region_set_height(r1, 100);
    ASSERT_EQ(rc, UFSMM_OK);

    double height;
    rc = ufsmm_region_get_height(r1, &height);
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT_EQ(height, 100);

    rc = ufsmm_set_region_name(r1, "Another region");
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add some new states in r1 */

    c1 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c1, "C1");
    rc = ufsmm_region_append_state(r1, c1);
    ASSERT_EQ(rc, UFSMM_OK);

    c2 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c2, "C2");
    rc = ufsmm_region_append_state(r1, c2);
    ASSERT_EQ(rc, UFSMM_OK);

    c3 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c3, "C3");
    rc = ufsmm_region_append_state(r1, c3);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create region in composit state C3 */

    rc = ufsmm_add_region(c3, false, &r2);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_set_region_name(r2, "Yet another region");
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add some new states in r2 */

    c31 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c31, "C31");
    rc = ufsmm_region_append_state(r2, c31);
    ASSERT_EQ(rc, UFSMM_OK);

    c32 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c32, "C32");
    rc = ufsmm_region_append_state(r2, c32);
    ASSERT_EQ(rc, UFSMM_OK);

    c33 = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(c33, "C33");
    rc = ufsmm_region_append_state(r2, c33);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_model_out.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(load_model3)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load("test_model_out.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

