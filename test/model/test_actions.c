#include <string.h>
#include <ufsm/model.h>
#include <json.h>
#include <sys/queue.h>
#include "../nala.h"
#include "common.h"

TEST(create_entry_action)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b, *c;
    struct ufsmm_action *action, *action2;
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
    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = ufsmm_model_write("test_entry_action.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_entry_action.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    struct ufsmm_actions *entries_list = &model->actions;//ufsmm_model_get_actions(model);

    printf("Model load %i\n", rc);
    printf("model->actions = %p\n", entries_list);

    uuid_unparse(entries_list->tqh_first->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(entries_list->tqh_first->name, "test-action");

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
    free(name);
}

TEST(delete_entry_action)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b, *c;
    struct ufsmm_action *action, *action2;
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

    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = ufsmm_model_write("test_delete_action.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_delete_action.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    struct ufsmm_actions *entries_list = &model->actions; //ufsmm_model_get_actions(model);

    printf("Model load %i\n", rc);
    printf("model->actions = %p\n", entries_list->tqh_first);

    uuid_unparse(entries_list->tqh_first->id, uuid_str2);
    ASSERT_EQ((char *) uuid_str, (char *) uuid_str2);
    ASSERT_EQ(entries_list->tqh_first->name, "test-action");

    printf("Deleting %s, %s\n", entries_list->tqh_first->name, uuid_str2);
    rc = ufsmm_model_delete_action(model, entries_list->tqh_first->id);
    ASSERT_EQ(rc, UFSMM_OK);
    printf("Done, saving model...\n");

    rc = ufsmm_model_write("test_delete_action.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
    free(name);

    /* Re-load model */
    rc = ufsmm_model_load("test_delete_action.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    entries_list = &model->actions; //ufsmm_model_get_actions(model);
    ASSERT_EQ(entries_list->tqh_first, NULL);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(delete_missing_entry_action)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b, *c;
    struct ufsmm_action *action, *action2;
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

    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_unparse(action->id, uuid_str);
    printf("Added action '%s'\n", uuid_str);
    name = strdup(action->name);
    ASSERT_EQ(name, "test-action");

    rc = ufsmm_model_write("test_delete_action2.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_delete_action2.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    struct ufsmm_actions *entries_list = &model->actions;//ufsmm_model_get_actions(model);

    uuid_t non_existing_entry = {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15};

    rc = ufsmm_model_delete_action(model, non_existing_entry);
    ASSERT_EQ(rc, -UFSMM_ERROR);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
    free(name);
}

TEST(add_entry_action_to_state)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a;
    struct ufsmm_action *action;

    printf("Creating model\n");
    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Adding state\n");
    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = ufsmm_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_add_entry_to_state.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_add_entry_to_state.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    struct ufsmm_action_ref *aref = TAILQ_FIRST(&a->entries);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = ufsmm_model_get_action(model, aref->act->id, UFSMM_ACTION_ENTRY, &action);
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT_EQ(action->name, "test-action");

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}


TEST(delete_entry_action_from_state)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a;
    struct ufsmm_action *action;

    printf("Creating model\n");
    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Adding state\n");
    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = ufsmm_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_delete_entry_from_state.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model */

    rc = ufsmm_model_load("test_delete_entry_from_state.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    struct ufsmm_action_ref *aref = TAILQ_FIRST(&a->entries);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = ufsmm_state_delete_entry(a, aref->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_delete_entry_from_state.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

/* Creates three entry actions, deletes the second one */
TEST(multiple_actions1)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a;
    struct ufsmm_action *action;

    printf("Creating model\n");
    rc = ufsmm_model_create(&model, "Test");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);
    ASSERT_EQ((char *) ufsmm_model_name(model), "Test");

    rc = ufsmm_set_region_name(model->root, "Root region");
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Adding state\n");
    a = ufsmm_state_new(UFSMM_STATE_NORMAL);
    ufsmm_state_set_name(a, "A");
    rc = ufsmm_region_append_state(model->root, a);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add first entry action */
    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action-1", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_t uu;
    uuid_generate_random(uu);
    rc = ufsmm_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add first second action */
    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action-2", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_generate_random(uu);
    rc = ufsmm_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Add first third action */
    rc = ufsmm_model_add_action(model, UFSMM_ACTION_ENTRY,
                                     "test-action-3", &action);
    ASSERT_EQ(rc, UFSMM_OK);

    uuid_generate_random(uu);
    rc = ufsmm_state_add_entry(model, a, uu, action->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_multiple_actions1.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model, and delete action two */

    rc = ufsmm_model_load("test_multiple_actions1.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    struct ufsmm_action_ref *aref = TAILQ_FIRST(&a->entries);
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = ufsmm_state_delete_entry(a, TAILQ_NEXT(aref, tailq)->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_multiple_actions1_1.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model, and delete action one */

    rc = ufsmm_model_load("test_multiple_actions1_1.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    aref = TAILQ_FIRST(&a->entries);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = ufsmm_state_delete_entry(a, aref->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_multiple_actions1_2.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model, and delete action three */

    rc = ufsmm_model_load("test_multiple_actions1_2.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    aref = TAILQ_FIRST(&a->entries);
    ASSERT(aref != NULL);
    ASSERT(aref->act != NULL);

    rc = ufsmm_state_delete_entry(a, aref->id);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_write("test_multiple_actions1_3.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Re-load model, now the list should be empty */

    rc = ufsmm_model_load("test_multiple_actions1_3.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = TAILQ_FIRST(&model->root->states);

    aref = TAILQ_FIRST(&a->entries);
    ASSERT(aref == NULL);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}
