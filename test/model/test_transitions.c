#include <string.h>
#include <sotc/sotc.h>
#include <sotc/model.h>
#include <json.h>
#include "nala.h"
#include "common.h"


/* Loads a model and verifies that all of the de-serialization has been done */
TEST(load_transitions)
{
    int rc;
    struct sotc_model *model;

    rc = sotc_model_load(SOTC_TEST_SRC"test_load_transitions.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

    ASSERT(model->root->state);
    ASSERT(model->root->state->transition != NULL);

    struct sotc_transition *t = model->root->state->transition;
    ASSERT_EQ(t->source.state->name, "A");
    ASSERT_EQ(t->source.offset, 20.0);
    ASSERT_EQ(t->source.side, SOTC_SIDE_RIGHT);
    ASSERT_EQ(t->dest.state->name, "B");
    ASSERT_EQ(t->dest.offset, 20.0);
    ASSERT_EQ(t->dest.side, SOTC_SIDE_LEFT);

    struct sotc_trigger *trigger = t->trigger;
    ASSERT_EQ(trigger->name, "eTestEvent1");

    ASSERT_EQ(t->text_block_coords.x, 10.0);
    ASSERT_EQ(t->text_block_coords.y, 10.0);
    ASSERT_EQ(t->text_block_coords.w, 100.0);
    ASSERT_EQ(t->text_block_coords.h, 50.0);

    struct sotc_vertice *v1, *v2;

    v1 = t->vertices;
    v2 = v1->next;
    ASSERT_EQ(v1->x, 100.0);
    ASSERT_EQ(v1->y, 100.0);
    ASSERT_EQ(v2->x, 100.0);
    ASSERT_EQ(v2->y, 110.0);

    struct sotc_action_ref *guards = t->guard;
    ASSERT_EQ(guards->act->name, "gSecond");

    struct sotc_action_ref *a1, *a2;

    a1 = t->action;
    a2 = a1->next;
    ASSERT_EQ(a1->act->name, "aFirst");
    ASSERT_EQ(a2->act->name, "aSecond");

    struct sotc_transition_state_condition *sconds;
    sconds = t->state_conditions;
    ASSERT_EQ(sconds->state->name, "C31");
    ASSERT(sconds->positive == false);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(create_one_transition)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b;

    rc = sotc_model_create(&model, "create_one_transition");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);

    /* Create states A and B */
    rc = sotc_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, SOTC_OK);

    /* Create a transition from A to B */
    struct sotc_transition *t;
    rc = sotc_state_add_transition(a, b, &t);
    ASSERT_EQ(rc, SOTC_OK);

    /* Create a trigger and assign it to transition 't' */
    struct sotc_trigger *trigger;
    rc = sotc_model_add_trigger(model, "eTestTrigger", &trigger);
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(trigger != NULL);

    rc = sotc_transition_set_trigger(model, t, trigger);
    ASSERT_EQ(rc, SOTC_OK);

    /* Write model to disk */
    rc = sotc_model_write("test_create_one_transition.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

    /* Reload model and verify the transition */

    rc = sotc_model_load("test_create_one_transition.sotc", &model);
    ASSERT_EQ(rc, SOTC_OK);

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

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);
}

TEST(create_multiple_transitions)
{
    int rc;
    struct sotc_model *model;
    struct sotc_state *a, *b;
    struct sotc_transition *t1, *t2, *t3;
    struct sotc_trigger *trigger1, *trigger2;

    rc = sotc_model_create(&model, "create_multiple_transitions1");
    ASSERT_EQ(rc, SOTC_OK);
    ASSERT(model != NULL);

    /* Create states A and B */
    printf("Creating states\n");
    rc = sotc_add_state(model->root, "A", &a);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_add_state(model->root, "B", &b);
    ASSERT_EQ(rc, SOTC_OK);

    /* Create transitions between A and B */
    printf("Creating transitions\n");
    rc = sotc_state_add_transition(a, b, &t1);
    ASSERT_EQ(rc, SOTC_OK);
    rc = sotc_state_add_transition(a, b, &t2);
    ASSERT_EQ(rc, SOTC_OK);
    rc = sotc_state_add_transition(b, a, &t3);
    ASSERT_EQ(rc, SOTC_OK);

    /* Create a trigger and assign it to transition 't' */
    printf("Creating triggers\n");
    rc = sotc_model_add_trigger(model, "eTestTrigger1", &trigger1);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_add_trigger(model, "eTestTrigger2", &trigger2);
    ASSERT_EQ(rc, SOTC_OK);

    printf("Assigning triggers\n");
    rc = sotc_transition_set_trigger(model, t1, trigger1);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_transition_set_trigger(model, t2, trigger2);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_transition_set_trigger(model, t3, trigger1);
    ASSERT_EQ(rc, SOTC_OK);

    /* Write model to disk */
    printf("Saving model...\n");
    rc = sotc_model_write("test_create_multiple_transitions.sotc", model);
    ASSERT_EQ(rc, SOTC_OK);

    rc = sotc_model_free(model);
    ASSERT_EQ(rc, SOTC_OK);

}

