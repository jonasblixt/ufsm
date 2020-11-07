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

    rc = ufsmm_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(model->root, "C", &c);
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

    rc = ufsmm_add_state(r1, "C1", &c1);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(r1, "C2", &c2);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(r1, "C3", &c3);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create region in composit state C3 */

    rc = ufsmm_add_region(c3, false, &r2);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_set_region_name(r2, "Yet another region");
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add some new states in r2 */

    rc = ufsmm_add_state(r2, "C31", &c31);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(r2, "C32", &c32);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(r2, "C33", &c33);
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

