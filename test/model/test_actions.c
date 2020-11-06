#include <string.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <json.h>
#include "nala.h"
#include "common.h"

TEST(create_entry_action)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b, *c;
    struct sotc_action *action, *action2;
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

    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = sotc_model_write("test_entry_action.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_entry_action.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    struct sotc_action *entries_list = sotc_model_get_entries(model);

    printf("Model load %i\n", rc);
    printf("model->actions = %p\n", entries_list);

    uuid_unparse(entries_list->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(entries_list->name, "test-action");

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
    free(name);
}

TEST(delete_entry_action)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b, *c;
    struct sotc_action *action, *action2;
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

    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = sotc_model_write("test_delete_action.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_delete_action.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    struct sotc_action *entries_list = sotc_model_get_entries(model);

    printf("Model load %i\n", rc);
    printf("model->actions = %p\n", entries_list);

    uuid_unparse(entries_list->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(entries_list->name, "test-action");

    printf("Deleting %s, %s\n", entries_list->name, uuid_str2);
    rc = sotc_model_delete_action(model, entries_list->id);
    ASSERT_EQ(rc, SOTC_OK);
    printf("Done, saving model...\n");

    rc = sotc_model_write("test_delete_action.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
    free(name);

    /* Re-load model */
    rc = sotc_model_load("test_delete_action.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    entries_list = sotc_model_get_entries(model);
    ASSERT_EQ(entries_list, NULL);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(delete_missing_entry_action)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b, *c;
    struct sotc_action *action, *action2;
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

    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = sotc_model_write("test_delete_action2.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_delete_action2.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    struct sotc_action *entries_list = sotc_model_get_entries(model);

    uuid_t non_existing_entry = {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15};

    rc = sotc_model_delete_action(model, non_existing_entry);
    ASSERT_EQ(rc, -SOTC_ERROR);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
    free(name);
}

TEST(add_entry_action_to_state)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a;
    struct sotc_action *action;

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

    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = sotc_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_add_entry_to_state.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_add_entry_to_state.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    struct sotc_action_ref *aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = sotc_model_get_action(model, aref->act->id, SOTC_ACTION_ENTRY, &action);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT_EQ(action->name, "test-action");

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}


TEST(delete_entry_action_from_state)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a;
    struct sotc_action *action;

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

    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = sotc_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_delete_entry_from_state.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model */

    rc = sotc_model_load("test_delete_entry_from_state.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    struct sotc_action_ref *aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = sotc_state_delete_entry(a, aref->act->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_delete_entry_from_state.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

/* Creates three entry actions, deletes the second one */
TEST(multiple_actions1)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a;
    struct sotc_action *action;

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

    /* Add first entry action */
    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action-1", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = sotc_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, SOTC_OK);

    /* Add first second action */
    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action-2", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_generate_random(uu);
    rc = sotc_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, SOTC_OK);

    /* Add first third action */
    rc = sotc_model_add_action(model, SOTC_ACTION_ENTRY,
                                     "test-action-3", &action);
    ASSERT_EQ(rc, SOTC_OK);

    uuid_generate_random(uu);
    rc = sotc_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_multiple_actions1.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model, and delete action two */

    rc = sotc_model_load("test_multiple_actions1.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    struct sotc_action_ref *aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = sotc_state_delete_entry(a, aref->next->act->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_multiple_actions1_1.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model, and delete action one */

    rc = sotc_model_load("test_multiple_actions1_1.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = sotc_state_delete_entry(a, aref->act->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_multiple_actions1_2.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model, and delete action three */

    rc = sotc_model_load("test_multiple_actions1_2.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = sotc_state_delete_entry(a, aref->act->id);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_write("test_multiple_actions1_3.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Re-load model, now the list should be empty */

    rc = sotc_model_load("test_multiple_actions1_3.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    a = model->root->state;

    aref = NULL;
    rc = sotc_state_get_entries(a, &aref);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(aref == NULL);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}
