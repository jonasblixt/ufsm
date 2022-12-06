#include <stdio.h>
#include <string.h>
#include <ufsm/model.h>
#include <json.h>

static int deserialize_vertices(json_object *j_vertices,
                                struct ufsmm_transition *t)
{
    struct ufsmm_vertice *vertice;
    json_object *j_vertice;
    json_object *j_obj;
    double x,y;
    size_t n_entries = json_object_array_length(j_vertices);

    if (n_entries == 0)
        return UFSMM_OK;

    L_DEBUG("Found %i vertices", n_entries);

    for (unsigned int n = 0; n < n_entries; n++) {
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

        // ufsmm_ll_append2(t->vertices, vertice);
        /*if (t->vertices == NULL) {
            t->vertices = vertice;
            prev = vertice;
        } else {
            prev->next = vertice;
            prev = prev->next;
        }*/
        TAILQ_INSERT_TAIL(&t->vertices, vertice, tailq);
    }

    return UFSMM_OK;
}

static int deserialize_state_ref(struct ufsmm_model *model,
                                 json_object *j_ref,
                                 struct ufsmm_transition_state_ref *result)
{
    json_object *j_state;
    json_object *j_side;
    json_object *j_offset;
    struct ufsmm_state *state = NULL;
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
    json_object *j_trigger_kind;
    json_object *j_source;
    json_object *j_dest;
    json_object *j_text_block;
    json_object *j_vertices;
    json_object *j_guards;
    json_object *j_actions;
    struct ufsmm_transition *transition;
    uuid_t trigger_uu;
    enum ufsmm_trigger_kind trigger_kind = UFSMM_TRIGGER_EVENT;

    size_t n_entries = json_object_array_length(j_transitions_list);

    if (n_entries == 0)
        return UFSMM_OK;

    L_DEBUG("Parsing transitions in state '%s'", state->name);

    for (unsigned int n = 0; n < n_entries; n++) {
        j_t = json_object_array_get_idx(j_transitions_list, n);

        rc = ufsmm_transition_new(&transition);

        if (rc != UFSMM_OK) {
            L_ERR("Could not allocate new transition");
            goto err_out;
        }

        if (!json_object_object_get_ex(j_t, "id", &j_id)) {
            L_ERR("Could not read ID");
            rc = -UFSMM_ERR_PARSE;
            goto err_out;
        }

        uuid_parse(json_object_get_string(j_id), transition->id);

        if (json_object_object_get_ex(j_t, "trigger-kind", &j_trigger_kind)) {
            trigger_kind = json_object_get_int(j_trigger_kind);
            L_ERR("Trigger kind = %i", trigger_kind);
        }

        if (json_object_object_get_ex(j_t, "trigger", &j_trigger)) {
            uuid_parse(json_object_get_string(j_trigger), trigger_uu);
            if (trigger_kind == UFSMM_TRIGGER_EVENT) {
                transition->trigger = ufsmm_model_get_trigger_from_uuid(model,
                                                                       trigger_uu);
                transition->trigger->usage_count++;
            } else {
                transition->signal = ufsmm_model_get_signal_from_uuid(model,
                                                                       trigger_uu);
                transition->signal->usage_count++;
            }
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

        /* Parse actions */
        if (json_object_object_get_ex(j_t, "actions", &j_actions)) {
            size_t n_aentries = json_object_array_length(j_actions);
            L_DEBUG("Transition has %d actions", n_aentries);

            for (unsigned int a = 0; a < n_aentries; a++) {
                json_object *j_action;
                json_object *j_action_id;
                json_object *j_aid;
                json_object *j_kind;
                uuid_t action_uu;
                uuid_t id_uu;
                enum ufsmm_action_ref_kind kind = UFSMM_ACTION_REF_NORMAL;

                j_action = json_object_array_get_idx(j_actions, a);

                if (json_object_object_get_ex(j_action, "kind", &j_kind))
                    kind = json_object_get_int(j_kind);

                if (kind == UFSMM_ACTION_REF_NORMAL) {
                    if (json_object_object_get_ex(j_action, "action-id", &j_action_id)) {
                        json_object_object_get_ex(j_action, "id", &j_aid);
                        uuid_parse(json_object_get_string(j_aid), id_uu);
                        uuid_parse(json_object_get_string(j_action_id), action_uu);
                        rc = ufsmm_transition_add_action(model, transition, id_uu,
                                                        action_uu);
                        if (rc != UFSMM_OK)
                            goto err_out;
                    }
                } else if (kind == UFSMM_ACTION_REF_SIGNAL) {
                    if (json_object_object_get_ex(j_action, "signal-id", &j_action_id)) {
                        json_object_object_get_ex(j_action, "id", &j_aid);
                        uuid_parse(json_object_get_string(j_aid), id_uu);
                        uuid_parse(json_object_get_string(j_action_id), action_uu);
                        rc = ufsmm_transition_add_signal_action(model, transition, id_uu,
                                                        action_uu);
                        if (rc != UFSMM_OK)
                            goto err_out;
                    }
                }
            }
        }

        /* Parse guards */
        if (json_object_object_get_ex(j_t, "guards", &j_guards)) {
            size_t n_gentries = json_object_array_length(j_guards);
            L_DEBUG("Transition has %d guards", n_gentries);

            for (unsigned int a = 0; a < n_gentries; a++) {
                json_object *j_guard;
                json_object *j_guard_id;
                json_object *j_state_id;
                json_object *j_gid;
                json_object *j_kind;
                json_object *j_value;
                uuid_t guard_uu;
                uuid_t state_uu;
                uuid_t id_uu;
                enum ufsmm_guard_kind guard_kind = UFSMM_GUARD_TRUE;
                int guard_value = 0;
                j_guard = json_object_array_get_idx(j_guards, a);

                if (json_object_object_get_ex(j_guard, "kind", &j_kind)) {
                    guard_kind = json_object_get_int(j_kind);
                }

                if ((guard_kind != UFSMM_GUARD_PSTATE) &&
                    (guard_kind != UFSMM_GUARD_NSTATE)) {
                    json_object_object_get_ex(j_guard, "action-id", &j_guard_id);
                    json_object_object_get_ex(j_guard, "id", &j_gid);
                    uuid_parse(json_object_get_string(j_gid), id_uu);
                    uuid_parse(json_object_get_string(j_guard_id), guard_uu);


                    if (json_object_object_get_ex(j_guard, "value", &j_value)) {
                        guard_value = json_object_get_int(j_value);
                    }

                    rc = ufsmm_transition_add_guard(model, transition, id_uu,
                                                    guard_uu, NULL, guard_kind,
                                                    guard_value, NULL);
                    if (rc != UFSMM_OK)
                        goto err_out;
                } else {
                    json_object_object_get_ex(j_guard, "state-id", &j_state_id);
                    json_object_object_get_ex(j_guard, "id", &j_gid);
                    uuid_parse(json_object_get_string(j_gid), id_uu);
                    uuid_parse(json_object_get_string(j_state_id), state_uu);

                    rc = ufsmm_transition_add_guard(model, transition, id_uu,
                                                    NULL, state_uu, guard_kind,
                                                    0, NULL);
                    if (rc != UFSMM_OK)
                        goto err_out;
                }
            }
        }

        L_DEBUG("Loaded transition '%s' -> '%s'", transition->source.state->name,
                                                  transition->dest.state->name);

        TAILQ_INSERT_TAIL(&state->transitions, transition, tailq);
    }



    return rc;
err_out:
    free(transition);
    return rc;
}

static int serialize_action_list(struct ufsmm_action_refs *list,
                                 json_object *output)
{
    json_object *action;
    char uuid_str[37];
    struct ufsmm_action_ref *item;

    TAILQ_FOREACH(item, list, tailq) {
        action = json_object_new_object();
        if (item->kind == UFSMM_ACTION_REF_NORMAL) {
            uuid_unparse(item->act->id, uuid_str);
            json_object_object_add(action, "action-id", json_object_new_string(uuid_str));
        } else {
            uuid_unparse(item->signal->id, uuid_str);
            json_object_object_add(action, "signal-id", json_object_new_string(uuid_str));
        }
        json_object_object_add(action, "kind", json_object_new_int(item->kind));
        uuid_unparse(item->id, uuid_str);
        json_object_object_add(action, "id", json_object_new_string(uuid_str));
        json_object_array_add(output, action);
    }

    return UFSMM_OK;
}

static int serialize_guard_list(struct ufsmm_guard_refs *list,
                                 json_object *output)
{
    json_object *guard;
    char uuid_str[37];
    struct ufsmm_guard_ref *item;

    TAILQ_FOREACH(item, list, tailq) {
        guard = json_object_new_object();
        if ((item->kind != UFSMM_GUARD_PSTATE) &&
            (item->kind != UFSMM_GUARD_NSTATE)) {
            uuid_unparse(item->act->id, uuid_str);
            json_object_object_add(guard, "action-id", json_object_new_string(uuid_str));
            json_object_object_add(guard, "value", json_object_new_int(item->value));
        } else {
            uuid_unparse(item->state->id, uuid_str);
            json_object_object_add(guard, "state-id", json_object_new_string(uuid_str));
        }
        json_object_object_add(guard, "kind", json_object_new_int(item->kind));
        uuid_unparse(item->id, uuid_str);
        json_object_object_add(guard, "id", json_object_new_string(uuid_str));
        json_object_array_add(output, guard);
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

    TAILQ_FOREACH(t, &state->transitions, tailq) {
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

        struct ufsmm_vertice *v;
        TAILQ_FOREACH(v, &t->vertices, tailq) {
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

        rc = serialize_guard_list(&t->guards, j_guards);
        if (rc != UFSMM_OK)
           goto err_out;

        json_object_object_add(j_t, "guards", j_guards);

        /* Add actions */
        json_object *j_actions = json_object_new_array();

        rc = serialize_action_list(&t->actions, j_actions);
        if (rc != UFSMM_OK)
           goto err_out;

        json_object_object_add(j_t, "actions", j_actions);

        json_object_array_add(j_output, j_t);
    }

    return UFSMM_OK;
err_out:
    return rc;
}

int ufsmm_transition_free_list(struct ufsmm_transitions *transitions)
{
    struct ufsmm_transition *t;

    if (transitions == NULL)
        return UFSMM_OK;

    while ((t = TAILQ_FIRST(transitions))) {
        TAILQ_REMOVE(transitions, t, tailq);
        if (ufsmm_transition_free_one(t) != UFSMM_OK) {
            L_ERR("Failed to free transition");
            return -UFSMM_ERROR;
        }
    }

    return UFSMM_OK;
}

int ufsmm_transition_free_one(struct ufsmm_transition *transition)
{
    struct ufsmm_vertice *v;

    if (transition == NULL)
        return UFSMM_OK;

    if (transition->source.state) {
        L_DEBUG("Freeing transition %s --> %s", transition->source.state->name,
                        transition->dest.state?transition->dest.state->name:"?");
    }

    if (transition->dest.state) {
        TAILQ_REMOVE(&transition->source.state->transitions, transition, tailq);
    }

    L_DEBUG("Freeing actions");
    free_action_ref_list(&transition->actions);
    L_DEBUG("Freeing guards");
    free_guard_ref_list(&transition->guards);

    while ((v = TAILQ_FIRST(&transition->vertices))) {
        TAILQ_REMOVE(&transition->vertices, v, tailq);
        free(v);
    }

    free(transition);
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
                              uuid_t action_id,
                              uuid_t state_id,
                              enum ufsmm_guard_kind kind,
                              int guard_value,
                              struct ufsmm_guard_ref **new_guard)
{
    struct ufsmm_action *action;
    struct ufsmm_state *state;
    struct ufsmm_guard_ref *guard;
    int rc;

    L_DEBUG("%s", __func__);

    if ((kind == UFSMM_GUARD_PSTATE) ||
        (kind == UFSMM_GUARD_NSTATE)) {

        state = ufsmm_model_get_state_from_uuid(model, state_id);

        if (state == NULL) {
            char uuid_str[37];
            uuid_unparse(state_id, uuid_str);
            L_ERR("Unkown state %s", uuid_str);
            return -1;
        }
    } else {
        rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_GUARD, &action);

        if (rc != UFSMM_OK) {
            char uuid_str[37];
            uuid_unparse(action_id, uuid_str);
            L_ERR("Unkown guard function %s", uuid_str);
            return rc;
        }

        L_DEBUG("Adding guard '%s' to transition", action->name);
    }

    guard = malloc(sizeof(struct ufsmm_guard_ref));
    memset(guard, 0, sizeof(*guard));
    guard->kind = kind;
    memcpy(guard->id, id, 16);

    if ((kind == UFSMM_GUARD_PSTATE) ||
        (kind == UFSMM_GUARD_NSTATE)) {
        guard->value = 0;
        guard->act = NULL;
        guard->state = state;
    } else {
        guard->value = guard_value;
        guard->act = action;
        action->usage_count++;
        guard->state = NULL;
    }
    TAILQ_INSERT_TAIL(&transition->guards, guard, tailq);

    if (new_guard != NULL) {
        (*new_guard) = guard;
    }
    return UFSMM_OK;
}

int ufsmm_transition_delete_guard(struct ufsmm_transition *transition, uuid_t id)
{
    return delete_guard_ref(&transition->guards, id);
}

int ufsmm_transition_add_action(struct ufsmm_model *model,
                               struct ufsmm_transition *transition,
                               uuid_t id,
                               uuid_t action_id)
{
    struct ufsmm_action *action;
    struct ufsmm_action_ref *aref;
    int rc;

    rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_ACTION, &action);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(id, uuid_str);
        L_ERR("Unkown action function %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding action '%s' to transition", action->name);

    aref = malloc(sizeof(struct ufsmm_action_ref));
    memset(aref, 0, sizeof(*aref));
    aref->act = action;
    action->usage_count++;
    memcpy(aref->id, id, 16);
    TAILQ_INSERT_TAIL(&transition->actions, aref, tailq);
    return UFSMM_OK;
}

int ufsmm_transition_add_signal_action(struct ufsmm_model *model,
                               struct ufsmm_transition *transition,
                               uuid_t id,
                               uuid_t signal_id)
{
    struct ufsmm_signal *signal;
    struct ufsmm_action_ref *aref;
    int rc;

    rc = ufsmm_model_get_signal(model, signal_id, &signal);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(id, uuid_str);
        L_ERR("Unkown signal %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding action signal '%s' to transition", signal->name);

    aref = malloc(sizeof(struct ufsmm_action_ref));
    memset(aref, 0, sizeof(*aref));
    aref->signal = signal;
    aref->kind = UFSMM_ACTION_REF_SIGNAL;
    memcpy(aref->id, id, 16);
    TAILQ_INSERT_TAIL(&transition->actions, aref, tailq);
    return UFSMM_OK;
}

int ufsmm_transition_change_src_state(struct ufsmm_transition *transition,
                                      struct ufsmm_state *new_state)
{
    struct ufsmm_transition_state_ref *src = &transition->source;
    struct ufsmm_state *old_state = src->state;
    src->state = new_state;

    TAILQ_REMOVE(&old_state->transitions, transition, tailq);
    TAILQ_INSERT_TAIL(&new_state->transitions, transition, tailq);

    return 0;
}

int ufsmm_transition_delete_action(struct ufsmm_transition *transition, uuid_t id)
{
    return delete_action_ref(&transition->actions, id);
}

int ufsmm_transition_new(struct ufsmm_transition **transition)
{
    struct ufsmm_transition *t;

    t = malloc(sizeof(*t));

    if (t == NULL)
        return -UFSMM_ERROR;

    memset(t, 0, sizeof(*t));

    if (transition) {
        (*transition) = t;
    }

    TAILQ_INIT(&t->vertices);
    TAILQ_INIT(&t->actions);
    TAILQ_INIT(&t->guards);
    uuid_generate_random(t->id);
    return 0;
}
