#include <stdio.h>
#include <string.h>
#include <ufsm/model/ufsmm.h>
#include <ufsm/model/model.h>
#include <json.h>


static int deserialize_state_conditions(struct ufsmm_model *model,
                                        json_object *j_state_conds,
                                        struct ufsmm_transition *t)
{
    struct ufsmm_transition_state_condition *state_cond, *prev;
    json_object *j_state_cond;
    json_object *j_state_id;
    json_object *j_positive;
    uuid_t state_uu;
    struct ufsmm_state *state;
    bool positive;
    size_t n_entries = json_object_array_length(j_state_conds);

    if (n_entries == 0)
        return UFSMM_OK;

    L_DEBUG("Found %i transition state conditions", n_entries);

    for (int n = 0; n < n_entries; n++) {
        j_state_cond = json_object_array_get_idx(j_state_conds, n);

        if (!json_object_object_get_ex(j_state_cond, "state-id", &j_state_id)) {
            L_ERR("Could not read state condition");
            return -UFSMM_ERROR;
        }

        uuid_parse(json_object_get_string(j_state_id), state_uu);
        state = ufsmm_model_get_state_from_uuid(model, state_uu);

        if (state == NULL) {
            L_ERR("Could not find state '%s'",
                        json_object_get_string(j_state_id));
            return -UFSMM_ERROR;
        }

        if (!json_object_object_get_ex(j_state_cond, "positive", &j_positive)) {
            L_ERR("Could not read positive");
            return -UFSMM_ERROR;
        }

        positive = json_object_get_boolean(j_positive);

        state_cond = malloc(sizeof(*state_cond));
        memset(state_cond, 0, sizeof(*state_cond));
        state_cond->state = state;
        state_cond->positive = positive;

        if (t->state_conditions == NULL) {
            t->state_conditions = state_cond;
            prev = state_cond;
        } else {
            prev->next = state_cond;
            prev = prev->next;
        }
    }

    return UFSMM_OK;
}

static int deserialize_vertices(json_object *j_vertices,
                                struct ufsmm_transition *t)
{
    struct ufsmm_vertice *vertice, *prev;
    json_object *j_vertice;
    json_object *j_obj;
    double x,y;
    size_t n_entries = json_object_array_length(j_vertices);

    if (n_entries == 0)
        return UFSMM_OK;

    L_DEBUG("Found %i vertices", n_entries);

    for (int n = 0; n < n_entries; n++) {
        j_vertice = json_object_array_get_idx(j_vertices, n);

        if (!json_object_object_get_ex(j_vertice, "x", &j_obj)) {
            L_ERR("Could read x");
            return -UFSMM_ERROR;
        }

        x = json_object_get_double(j_obj);

        if (!json_object_object_get_ex(j_vertice, "y", &j_obj)) {
            L_ERR("Could read y");
            return -UFSMM_ERROR;
        }

        y = json_object_get_double(j_obj);

        vertice = malloc(sizeof(*vertice));
        memset(vertice, 0, sizeof(*vertice));
        vertice->x = x;
        vertice->y = y;

        if (t->vertices == NULL) {
            t->vertices = vertice;
            prev = vertice;
        } else {
            prev->next = vertice;
            prev = prev->next;
        }
    }

    return UFSMM_OK;
}

static int deserialize_state_ref(struct ufsmm_model *model,
                                 json_object *j_ref,
                                 struct ufsmm_transition_state_ref *result)
{
    int rc;
    json_object *j_state;
    json_object *j_side;
    json_object *j_offset;
    struct ufsmm_state *state = NULL;
    double offset;
    enum ufsmm_side side;
    uuid_t state_uu;

    if (!json_object_object_get_ex(j_ref, "state", &j_state)) {
        L_ERR("Could not parse state");
        return -UFSMM_ERROR;
    }

    uuid_parse(json_object_get_string(j_state), state_uu);

    if (!json_object_object_get_ex(j_ref, "side", &j_side)) {
        L_ERR("Could not parse side");
        return -UFSMM_ERROR;
    }

    if (!json_object_object_get_ex(j_ref, "offset", &j_offset)) {
        L_ERR("Could not parse offset");
        return -UFSMM_ERROR;
    }

    L_DEBUG("Searching for state '%s'", json_object_get_string(j_state));
    state = ufsmm_model_get_state_from_uuid(model, state_uu);

    if (state == NULL) {
        L_ERR("Could not find state");
        return -UFSMM_ERROR;
    }
    if (strcmp(json_object_get_string(j_side), "left") == 0) {
        result->side = UFSMM_SIDE_LEFT;
    } else if (strcmp(json_object_get_string(j_side), "right") == 0) {
        result->side = UFSMM_SIDE_RIGHT;
    } else if (strcmp(json_object_get_string(j_side), "top") == 0) {
        result->side = UFSMM_SIDE_TOP;
    } else if (strcmp(json_object_get_string(j_side), "bottom") == 0) {
        result->side = UFSMM_SIDE_BOTTOM;
    } else {
        L_ERR("Uknown side: '%s'", json_object_get_string(j_side));
        return -UFSMM_ERROR;
    }

    result->offset = json_object_get_double(j_offset);
    result->state = state;

    return UFSMM_OK;
}

int ufsmm_transition_deserialize(struct ufsmm_model *model,
                                struct ufsmm_state *state,
                                json_object *j_transitions_list)
{
    int rc = UFSMM_OK;
    json_object *j_t;
    json_object *j_id;
    json_object *j_trigger;
    json_object *j_source;
    json_object *j_dest;
    json_object *j_text_block;
    json_object *j_vertices;
    json_object *j_guards;
    json_object *j_actions;
    json_object *j_state_conds;
    struct ufsmm_transition *transition;
    struct ufsmm_transition *prev;
    uuid_t trigger_uu;

    size_t n_entries = json_object_array_length(j_transitions_list);

    if (n_entries == 0)
        return UFSMM_OK;

    L_DEBUG("Parsing transitions in state '%s'", state->name);

    for (int n = 0; n < n_entries; n++) {
        j_t = json_object_array_get_idx(j_transitions_list, n);

        transition = malloc(sizeof(struct ufsmm_transition));

        if (transition == NULL)
            return -UFSMM_ERROR;

        memset(transition, 0, sizeof(*transition));

        if (!json_object_object_get_ex(j_t, "id", &j_id)) {
            L_ERR("Could not read ID");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        uuid_parse(json_object_get_string(j_id), transition->id);

        if (json_object_object_get_ex(j_t, "trigger", &j_trigger)) {
            uuid_parse(json_object_get_string(j_trigger), trigger_uu);
            transition->trigger = ufsmm_model_get_trigger_from_uuid(model,
                                                                   trigger_uu);
        }

/*
        if (transition->trigger == NULL) {
            L_ERR("Could not find trigger");
            rc = -UFSMM_ERROR;
            goto err_out;
        }
*/
        if (!json_object_object_get_ex(j_t, "source", &j_source)) {
            L_ERR("Could find source state");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        rc = deserialize_state_ref(model, j_source, &transition->source);

        if (rc != UFSMM_OK) {
            L_ERR("Could not parse source state");
            goto err_out;
        }

        if (!json_object_object_get_ex(j_t, "dest", &j_dest)) {
            L_ERR("Could find dest state");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        rc = deserialize_state_ref(model, j_dest, &transition->dest);

        if (rc != UFSMM_OK) {
            L_ERR("Could not parse source state");
            goto err_out;
        }

        if (!json_object_object_get_ex(j_t, "text-block", &j_text_block)) {
            L_ERR("Could not read text-block");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        rc = ufsmm_model_deserialize_coords(j_text_block,
                                     &transition->text_block_coords);

        if (rc != UFSMM_OK) {
            L_ERR("Could not de-serialize test-block coordinates");
            goto err_out;
        }

        if (!json_object_object_get_ex(j_t, "vertices", &j_vertices)) {
            L_ERR("Could not read vertices");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        rc = deserialize_vertices(j_vertices, transition);

        if (rc != UFSMM_OK) {
            L_ERR("Could not de-serialize transition vertices");
            goto err_out;
        }

        if (!json_object_object_get_ex(j_t, "state-condition", &j_state_conds)) {
            L_ERR("Could not read transition state conditions");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        rc = deserialize_state_conditions(model, j_state_conds, transition);

        if (rc != UFSMM_OK) {
            L_ERR("Could not de-serialize transition state conditions");
            goto err_out;
        }

        /* Parse actions */
        if (json_object_object_get_ex(j_t, "actions", &j_actions)) {
            size_t n_entries = json_object_array_length(j_actions);
            L_DEBUG("Transition has %d actions", n_entries);

            for (int n = 0; n < n_entries; n++)
            {
                json_object *j_action;
                json_object *j_action_id;
                json_object *j_id;
                uuid_t action_uu;
                uuid_t id_uu;

                j_action = json_object_array_get_idx(j_actions, n);

                if (json_object_object_get_ex(j_action, "action-id", &j_action_id)) {
                    json_object_object_get_ex(j_action, "id", &j_id);
                    uuid_parse(json_object_get_string(j_id), id_uu);
                    uuid_parse(json_object_get_string(j_action_id), action_uu);
                    rc = ufsmm_transition_add_action(model, transition, id_uu,
                                                    action_uu);
                    if (rc != UFSMM_OK)
                        goto err_out;
                }
            }
        }

        /* Parse guards */
        if (json_object_object_get_ex(j_t, "guards", &j_guards)) {
            size_t n_entries = json_object_array_length(j_guards);
            L_DEBUG("Transition has %d guards", n_entries);

            for (int n = 0; n < n_entries; n++)
            {
                json_object *j_guard;
                json_object *j_guard_id;
                json_object *j_id;
                uuid_t guard_uu;
                uuid_t id_uu;
                j_guard = json_object_array_get_idx(j_guards, n);

                if (json_object_object_get_ex(j_guard, "action-id", &j_guard_id)) {
                    json_object_object_get_ex(j_guard, "id", &j_id);
                    uuid_parse(json_object_get_string(j_id), id_uu);
                    uuid_parse(json_object_get_string(j_guard_id), guard_uu);
                    rc = ufsmm_transition_add_guard(model, transition, id_uu,
                                                    guard_uu);
                    if (rc != UFSMM_OK)
                        goto err_out;
                }
            }
        }

        L_DEBUG("Loaded transition '%s' -> '%s'", transition->source.state->name,
                                                  transition->dest.state->name);

        if (state->transition == NULL) {
            state->transition = transition;
            transition->prev = NULL;
        } else {
            struct ufsmm_transition *list = state->transition;

            while (list->next)
                list = list->next;
            list->next = transition;
            transition->prev = list;
        }
    }



    return rc;
err_out:
    free(transition);
    return rc;
}

static int serialize_action_list(struct ufsmm_action_ref *list,
                                 json_object *output)
{
    json_object *action;
    char uuid_str[37];
    struct ufsmm_action_ref *tmp = list;

    while (tmp) {
        uuid_unparse(tmp->act->id, uuid_str);
        action = json_object_new_object();
        json_object_object_add(action, "id", json_object_new_string(uuid_str));
        json_object_array_add(output, action);
        tmp = tmp->next;
    }

    return UFSMM_OK;
}

int ufsmm_transitions_serialize(struct ufsmm_state *state,
                              json_object *j_output)
{
    int rc;
    json_object *j_t;
    json_object *j_t_id;
    json_object *j_trigger_id;
    json_object *j_source_state;
    json_object *j_dest_state;
    struct ufsmm_transition *t;
    char uuid_str[37];

    L_DEBUG("Serializing transitions belonging to state '%s'", state->name);

    for (t = state->transition; t; t = t->next) {
        j_t = json_object_new_object();

        /* Add UUID */
        uuid_unparse(t->id, uuid_str);
        j_t_id = json_object_new_string(uuid_str);
        json_object_object_add(j_t, "id", j_t_id);

        /* Add trigger */
        if (t->trigger) {
            uuid_unparse(t->trigger->id, uuid_str);
            j_trigger_id = json_object_new_string(uuid_str);
            json_object_object_add(j_t, "trigger", j_trigger_id);
        }

        /* Add source state */
        j_source_state = json_object_new_object();
        uuid_unparse(t->source.state->id, uuid_str);
        json_object_object_add(j_source_state, "state",
                               json_object_new_string(uuid_str));
        const char *side_str;
        switch (t->source.side) {
            case UFSMM_SIDE_LEFT:
                side_str = "left";
            break;
            case UFSMM_SIDE_RIGHT:
                side_str = "right";
            break;
            case UFSMM_SIDE_TOP:
                side_str = "top";
            break;
            case UFSMM_SIDE_BOTTOM:
                side_str = "bottom";
            break;
            default:
                side_str = "bottom";
        }

        json_object_object_add(j_source_state, "side",
                               json_object_new_string(side_str));
        json_object_object_add(j_source_state, "offset",
                               json_object_new_double(t->source.offset));
        json_object_object_add(j_t, "source", j_source_state);

        /* Add destination state */
        j_dest_state = json_object_new_object();
        uuid_unparse(t->dest.state->id, uuid_str);
        json_object_object_add(j_dest_state, "state",
                               json_object_new_string(uuid_str));
        switch (t->dest.side) {
            case UFSMM_SIDE_LEFT:
                side_str = "left";
            break;
            case UFSMM_SIDE_RIGHT:
                side_str = "right";
            break;
            case UFSMM_SIDE_TOP:
                side_str = "top";
            break;
            case UFSMM_SIDE_BOTTOM:
                side_str = "bottom";
            break;
            default:
                side_str = "bottom";
        }

        json_object_object_add(j_dest_state, "side",
                               json_object_new_string(side_str));
        json_object_object_add(j_dest_state, "offset",
                               json_object_new_double(t->dest.offset));
        json_object_object_add(j_t, "dest", j_dest_state);

        /* Text block */
        json_object *j_text_block = json_object_new_object();
        json_object_object_add(j_text_block, "x",
                               json_object_new_double(t->text_block_coords.x));
        json_object_object_add(j_text_block, "y",
                               json_object_new_double(t->text_block_coords.y));
        json_object_object_add(j_text_block, "w",
                               json_object_new_double(t->text_block_coords.w));
        json_object_object_add(j_text_block, "h",
                               json_object_new_double(t->text_block_coords.h));

        json_object_object_add(j_t, "text-block", j_text_block);

        /* Add vertices */
        json_object *j_vertices = json_object_new_array();

        for (struct ufsmm_vertice *v = t->vertices; v; v = v->next) {
            json_object *j_vertice = json_object_new_object();

            json_object_object_add(j_vertice, "x",
                                   json_object_new_double(v->x));

            json_object_object_add(j_vertice, "y",
                                   json_object_new_double(v->y));

            json_object_array_add(j_vertices, j_vertice);
        }

        json_object_object_add(j_t, "vertices", j_vertices);

        /* Add guards */
        json_object *j_guards = json_object_new_array();

        rc = serialize_action_list(t->guard, j_guards);
        if (rc != UFSMM_OK)
           goto err_out;

        json_object_object_add(j_t, "guards", j_guards);

        /* Add actions */
        json_object *j_actions = json_object_new_array();

        rc = serialize_action_list(t->action, j_actions);
        if (rc != UFSMM_OK)
           goto err_out;

        json_object_object_add(j_t, "actions", j_actions);

        /* State transitions conditions */
        json_object *j_state_conds = json_object_new_array();
        struct ufsmm_transition_state_condition *sconds = t->state_conditions;
        for (; sconds; sconds = sconds->next) {
            json_object *j_state_cond = json_object_new_object();
            uuid_unparse(sconds->state->id, uuid_str);
            json_object_object_add(j_state_cond, "state-id",
                                    json_object_new_string(uuid_str));
            json_object_object_add(j_state_cond, "positive",
                                    json_object_new_boolean(sconds->positive));
            json_object_array_add(j_state_conds, j_state_cond);
        }

        json_object_object_add(j_t, "state-condition", j_state_conds);
        json_object_array_add(j_output, j_t);
    }

    return UFSMM_OK;
err_out:
    return rc;
}

int ufsmm_transition_free(struct ufsmm_transition *transition)
{
    struct ufsmm_transition *list = transition;
    struct ufsmm_transition *tmp;
    struct ufsmm_vertice *v, *v_tmp;
    struct ufsmm_transition_state_condition *sc, *sc_tmp;

    if (transition == NULL)
        return UFSMM_OK;

    while (list)
    {
        tmp = list->next;
        free_action_ref_list(transition->action);
        free_action_ref_list(transition->guard);

        v = transition->vertices;

        while (v) {
            v_tmp = v->next;
            free(v);
            v = v_tmp;
        }

        sc = transition->state_conditions;

        while (sc) {
            sc_tmp = sc->next;
            free(sc);
            sc = sc_tmp;
        }

        free(list);
        list = tmp;
    }

    return UFSMM_OK;
}

int ufsmm_transition_set_trigger(struct ufsmm_model *model,
                                struct ufsmm_transition *transition,
                                struct ufsmm_trigger *trigger)
{
    transition->trigger = trigger;
    return UFSMM_OK;
}

int ufsmm_transition_add_guard(struct ufsmm_model *model,
                              struct ufsmm_transition *transition,
                              uuid_t id,
                              uuid_t action_id)
{
    struct ufsmm_action *action;
    int rc;

    L_DEBUG("%s", __func__);

    rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_GUARD, &action);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(action_id, uuid_str);
        L_ERR("Unkown guard function %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding guard '%s' to transition", action->name);
    struct ufsmm_action_ref *list = transition->guard;

    if (list == NULL) {
        list = malloc(sizeof(struct ufsmm_action_ref));
        memset(list, 0, sizeof(*list));
        list->act = action;
        memcpy(list->id, id, 16);
        transition->guard = list;
    } else {
        while (list->next)
            list = list->next;
        list->next = malloc(sizeof(struct ufsmm_action_ref));
        memset(list->next, 0, sizeof(*list->next));
        list->next->act = action;
        memcpy(list->next->id, id, 16);
    }

    return UFSMM_OK;
}

int ufsmm_transition_delete_guard(struct ufsmm_transition *transition, uuid_t id)
{
    return UFSMM_OK;
}

struct ufsmm_action_ref *ufsmm_transition_get_guards(struct ufsmm_transition *t)
{
    return t->guard;
}

int ufsmm_transition_add_action(struct ufsmm_model *model,
                               struct ufsmm_transition *transition,
                               uuid_t id,
                               uuid_t action_id)
{
    struct ufsmm_action *action;
    int rc;

    rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_ACTION, &action);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(id, uuid_str);
        L_ERR("Unkown action function %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding action '%s' to transition", action->name);
    struct ufsmm_action_ref *list = transition->action;

    if (list == NULL) {
        list = malloc(sizeof(struct ufsmm_action_ref));
        memset(list, 0, sizeof(*list));
        list->act = action;
        memcpy(list->id, id, 16);
        transition->action = list;
    } else {
        while (list->next)
            list = list->next;
        list->next = malloc(sizeof(struct ufsmm_action_ref));
        memset(list->next, 0, sizeof(*list->next));
        list->next->act = action;
        memcpy(list->next->id, id, 16);
    }

    return UFSMM_OK;
}

int ufsmm_transition_delete_action(struct ufsmm_transition *transition, uuid_t id)
{
    return UFSMM_OK;
}

struct ufsmm_action_ref *ufsmm_transition_get_actions(struct ufsmm_transition *t)
{
    return t->action;
}

int ufsmm_transition_add_state_condition(struct ufsmm_model *model,
                                        struct ufsmm_transition *transition,
                                        uuid_t id,
                                        bool positive)
{
    return UFSMM_OK;
}

int ufsmm_transition_delete_state_condition(struct ufsmm_transition *transition,
                                            uuid_t id)
{
    return UFSMM_OK;
}

struct ufsmm_transition_state_condition *
ufsmm_transition_get_state_conditions(struct ufsmm_transition *t)
{
    return t->state_conditions;
}
