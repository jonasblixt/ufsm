#include <string.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <json.h>
#include "nala.h"
#include "common.h"

TEST(create_one_trigger)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a;
    struct sotc_trigger *trigger, *trigger2;
    char *name;
    char uuid_str[37];
    char uuid_str2[37];

    printf("Creating model\n");
    rc = sotc_model_create(&model, "Test");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) sotc_model_name(model), "Test");

    rc = sotc_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, SOTC_OK);

    printf("Adding state\n");
    rc = sotc_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_add_trigger(model, "eTestEvent", &trigger);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_unparse(trigger->id, uuid_str);
    printf("Added trigger '%s'\n", uuid_str);
    name = strdup(trigger->name);
    ASSERT_EQ(name, "eTestEvent");

    rc = sotc_model_write("test_one_trigger.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_one_trigger.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    struct sotc_trigger *triggers = sotc_model_get_triggers(model);

    printf("Model load %i\n", rc);
    printf("model->triggers = %p\n", triggers);

    uuid_unparse(triggers->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(triggers->name, "eTestEvent");

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
    free(name);
}

TEST(delete_one_trigger)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a;
    struct sotc_trigger *trigger, *trigger2;
    char uuid_str[37];
    char uuid_str2[37];

    printf("Creating model\n");
    rc = sotc_model_create(&model, "Test");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) sotc_model_name(model), "Test");

    rc = sotc_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, SOTC_OK);

    printf("Adding state\n");
    rc = sotc_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_add_trigger(model, "eTestEvent", &trigger);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_unparse(trigger->id, uuid_str);
    printf("Added trigger '%s'\n", uuid_str);

    rc = sotc_model_write("test_delete_trigger1.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model and delete trigger */
    printf("Reloading model...\n");
    rc = sotc_model_load("test_delete_trigger1.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    struct sotc_trigger *triggers = sotc_model_get_triggers(model);

    printf("Model load %i\n", rc);
    printf("model->triggers = %p\n", triggers);

    rc = sotc_model_delete_trigger(model, triggers->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_delete_trigger2.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model verify that there are not triggers */
    rc = sotc_model_load("test_delete_trigger2.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    triggers = sotc_model_get_triggers(model);
    ASSERT(triggers == NULL);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}
