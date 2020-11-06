#include <string.h>
#include <ufsm/model/ufsmm.h>
#include <ufsm/model/model.h>
#include <json.h>
#include "../nala.h"
#include "common.h"

TEST(create_one_trigger)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a;
    struct ufsmm_trigger *trigger, *trigger2;
    char *name;
    char uuid_str[37];
    char uuid_str2[37];

    printf("Creating model\n");
    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Adding state\n");
    rc = ufsmm_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_trigger(model, "eTestEvent", &trigger);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_unparse(trigger->id, uuid_str);
    printf("Added trigger '%s'\n", uuid_str);
    name = strdup(trigger->name);
    ASSERT_EQ(name, "eTestEvent");

    rc = ufsmm_model_write("test_one_trigger.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_one_trigger.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    struct ufsmm_trigger *triggers = ufsmm_model_get_triggers(model);

    printf("Model load %i\n", rc);
    printf("model->triggers = %p\n", triggers);

    uuid_unparse(triggers->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(triggers->name, "eTestEvent");

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
    free(name);
}

TEST(delete_one_trigger)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a;
    struct ufsmm_trigger *trigger, *trigger2;
    char uuid_str[37];
    char uuid_str2[37];

    printf("Creating model\n");
    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Adding state\n");
    rc = ufsmm_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_trigger(model, "eTestEvent", &trigger);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_unparse(trigger->id, uuid_str);
    printf("Added trigger '%s'\n", uuid_str);

    rc = ufsmm_model_write("test_delete_trigger1.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model and delete trigger */
    printf("Reloading model...\n");
    rc = ufsmm_model_load("test_delete_trigger1.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    struct ufsmm_trigger *triggers = ufsmm_model_get_triggers(model);

    printf("Model load %i\n", rc);
    printf("model->triggers = %p\n", triggers);

    rc = ufsmm_model_delete_trigger(model, triggers->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_delete_trigger2.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model verify that there are not triggers */
    rc = ufsmm_model_load("test_delete_trigger2.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    triggers = ufsmm_model_get_triggers(model);
    ASSERT(triggers == NULL);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}
