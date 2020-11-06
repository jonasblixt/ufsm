#include <string.h>
#include <ufsm/model/ufsmm.h>
#include <ufsm/model/model.h>
#include <json.h>
#include "../nala.h"
#include "common.h"


/* Loads a model and verifies that all of the de-serialization has been done */
TEST(load_transitions)
{
    int rc;
    struct ufsmm_model *model;

    rc = ufsmm_model_load(UFSMM_TEST_SRC"test_load_transitions.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    ASSERT(model->root->state);
    ASSERT(model->root->state->transition != NULL);

    struct ufsmm_transition *t = model->root->state->transition;
    ASSERT_EQ(t->source.state->name, "A");
    ASSERT_EQ(t->source.offset, 20.0);
    ASSERT_EQ(t->source.side, UFSMM_SIDE_RIGHT);
    ASSERT_EQ(t->dest.state->name, "B");
    ASSERT_EQ(t->dest.offset, 20.0);
    ASSERT_EQ(t->dest.side, UFSMM_SIDE_LEFT);

    struct ufsmm_trigger *trigger = t->trigger;
    ASSERT_EQ(trigger->name, "eTestEvent1");

    ASSERT_EQ(t->text_block_coords.x, 10.0);
    ASSERT_EQ(t->text_block_coords.y, 10.0);
    ASSERT_EQ(t->text_block_coords.w, 100.0);
    ASSERT_EQ(t->text_block_coords.h, 50.0);

    struct ufsmm_vertice *v1, *v2;

    v1 = t->vertices;
    v2 = v1->next;
    ASSERT_EQ(v1->x, 100.0);
    ASSERT_EQ(v1->y, 100.0);
    ASSERT_EQ(v2->x, 100.0);
    ASSERT_EQ(v2->y, 110.0);

    struct ufsmm_action_ref *guards = t->guard;
    ASSERT_EQ(guards->act->name, "gSecond");

    struct ufsmm_action_ref *a1, *a2;

    a1 = t->action;
    a2 = a1->next;
    ASSERT_EQ(a1->act->name, "aFirst");
    ASSERT_EQ(a2->act->name, "aSecond");

    struct ufsmm_transition_state_condition *sconds;
    sconds = t->state_conditions;
    ASSERT_EQ(sconds->state->name, "C31");
    ASSERT(sconds->positive == false);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(create_one_transition)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b;

    rc = ufsmm_model_create(&model, "create_one_transition");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);

    /* Create states A and B */
    rc = ufsmm_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create a transition from A to B */
    struct ufsmm_transition *t;
    rc = ufsmm_state_add_transition(a, b, &t);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create a trigger and assign it to transition 't' */
    struct ufsmm_trigger *trigger;
    rc = ufsmm_model_add_trigger(model, "eTestTrigger", &trigger);
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(trigger != NULL);

    rc = ufsmm_transition_set_trigger(model, t, trigger);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Write model to disk */
    rc = ufsmm_model_write("test_create_one_transition.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Reload model and verify the transition */

    rc = ufsmm_model_load("test_create_one_transition.ufsm", &model);
    ASSERT_EQ(rc, UFSMM_OK);

    a = model->root->state;
    b = a->next;
    ASSERT(a != NULL);
    ASSERT(b != NULL);

    t = a->transition;
    ASSERT(t != NULL);
    ASSERT_EQ(t->source.state->name, "A");
    ASSERT_EQ(t->dest.state->name, "B");

    trigger = t->trigger;
    ASSERT(trigger != NULL);
    ASSERT_EQ(trigger->name, "eTestTrigger");

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);
}

TEST(create_multiple_transitions)
{
    int rc;
    struct ufsmm_model *model;
    struct ufsmm_state *a, *b;
    struct ufsmm_transition *t1, *t2, *t3;
    struct ufsmm_trigger *trigger1, *trigger2;

    rc = ufsmm_model_create(&model, "create_multiple_transitions1");
    ASSERT_EQ(rc, UFSMM_OK);
    ASSERT(model != NULL);

    /* Create states A and B */
    printf("Creating states\n");
    rc = ufsmm_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create transitions between A and B */
    printf("Creating transitions\n");
    rc = ufsmm_state_add_transition(a, b, &t1);
    ASSERT_EQ(rc, UFSMM_OK);
    rc = ufsmm_state_add_transition(a, b, &t2);
    ASSERT_EQ(rc, UFSMM_OK);
    rc = ufsmm_state_add_transition(b, a, &t3);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Create a trigger and assign it to transition 't' */
    printf("Creating triggers\n");
    rc = ufsmm_model_add_trigger(model, "eTestTrigger1", &trigger1);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_add_trigger(model, "eTestTrigger2", &trigger2);
    ASSERT_EQ(rc, UFSMM_OK);

    printf("Assigning triggers\n");
    rc = ufsmm_transition_set_trigger(model, t1, trigger1);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_transition_set_trigger(model, t2, trigger2);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_transition_set_trigger(model, t3, trigger1);
    ASSERT_EQ(rc, UFSMM_OK);

    /* Write model to disk */
    printf("Saving model...\n");
    rc = ufsmm_model_write("test_create_multiple_transitions.ufsm", model);
    ASSERT_EQ(rc, UFSMM_OK);

    rc = ufsmm_model_free(model);
    ASSERT_EQ(rc, UFSMM_OK);

}

