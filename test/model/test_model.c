#include <string.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <json.h>
#include "nala.h"
#include "common.h"

TEST(load_model)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load(SOTC_TEST_SRC"test1.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(load_empty_root)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load(SOTC_TEST_SRC"test_empty_root.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Model load %i\n", rc);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(create_model)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_create(&model, "Test");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) sotc_model_name(model), "Test");
    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(load_model2)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load(SOTC_TEST_SRC"test2.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(write_model)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b, *c;
    struct sotc_region *r1, *r2;
    struct sotc_state *c1, *c2, *c3;
    struct sotc_state *c31, *c32, *c33;

    rc = sotc_model_create(&model, "Test");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) sotc_model_name(model), "Test");

    rc = sotc_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(model->root, "C", &c);
    ASSERT_EQ(rc, SOTC_OK);

    /* Add region in composit state C */
    rc = sotc_add_region(c, false, &r1);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_region_set_height(r1, 100);
    ASSERT_EQ(rc, SOTC_OK);

    double height;
    rc = sotc_region_get_height(r1, &height);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT_EQ(height, 100);

    rc = sotc_set_region_name(r1, "Another region");
    ASSERT_EQ(rc, SOTC_OK);

    /* Add some new states in r1 */

    rc = sotc_add_state(r1, "C1", &c1);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(r1, "C2", &c2);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(r1, "C3", &c3);
    ASSERT_EQ(rc, SOTC_OK);

    /* Create region in composit state C3 */

    rc = sotc_add_region(c3, false, &r2);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_set_region_name(r2, "Yet another region");
    ASSERT_EQ(rc, SOTC_OK);

    /* Add some new states in r2 */

    rc = sotc_add_state(r2, "C31", &c31);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(r2, "C32", &c32);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(r2, "C33", &c33);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_model_out.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(load_model3)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load("test_model_out.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Model load %i\n", rc);

    json_object_object_foreach(model->jroot, key, val)
    {
        printf("%s: %s\n", key, json_object_get_string(val));
    }


    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

