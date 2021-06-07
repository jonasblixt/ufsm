#include <stdio.h>
#include <string.h>
#include <ufsm/model.h>
#include <json.h>


int ufsmm_add_state(struct ufsmm_region *region, const char *name,
                    struct ufsmm_state **out)
{
    struct ufsmm_state *state = malloc(sizeof(struct ufsmm_state));

    if (!state)
        return -UFSMM_ERR_MEM;

    memset(state, 0, sizeof(*state));
    TAILQ_INIT(&state->transitions);
    TAILQ_INIT(&state->entries);
    TAILQ_INIT(&state->exits);
    (*out) = state;

    state->name = strdup(name);
    state->parent_region = region;

    uuid_generate_random(state->id);

    if (region->last_state) {
        state->prev = region->last_state;
        region->last_state->next = state;
        region->last_state = state;
    }
    if (!region->state)
        region->state = state;

    region->last_state = state;

    return UFSMM_OK;
}

int ufsmm_state_append_region(struct ufsmm_state *state, struct ufsmm_region *r)
{
    if (state)
    {
        L_DEBUG("Belongs to %s", state->name);
        /* Place region last in the list of regions for this state */
        if (!state->regions)
        {
            state->regions = r;
        }

        if (!state->last_region)
        {
            state->last_region = r;
        }
        else
        {
            state->last_region->next = r;
            state->last_region = r;
        }
    }

    return UFSMM_OK;
}

int ufsmm_state_set_size(struct ufsmm_state *s, double x, double y)
{
    s->w = x;
    s->h = y;
    return UFSMM_OK;
}

int ufsmm_state_set_xy(struct ufsmm_state *s, double x, double y)
{
    s->x = x;
    s->y = y;
    return UFSMM_OK;
}

int ufsmm_state_get_size(struct ufsmm_state *s, double *x, double *y)
{
    (*x) = s->w;
    (*y) = s->h;
    return UFSMM_OK;
}

int ufsmm_state_get_xy(struct ufsmm_state *s, double *x, double *y)
{
    (*x) = s->x;
    (*y) = s->y;
    return UFSMM_OK;
}

static int serialize_action_list(struct ufsmm_action_refs *list,
                                 json_object *output)
{
    json_object *action;
    char uuid_str[37];
    struct ufsmm_action_ref *tmp;

    TAILQ_FOREACH(tmp, list, tailq) {
        action = json_object_new_object();
        uuid_unparse(tmp->id, uuid_str);
        json_object_object_add(action, "id", json_object_new_string(uuid_str));
        uuid_unparse(tmp->act->id, uuid_str);
        json_object_object_add(action, "action-id", json_object_new_string(uuid_str));
        json_object_array_add(output, action);
    }

    return UFSMM_OK;
}

/* Translate the internal structure to json */
int ufsmm_state_serialize(struct ufsmm_state *state, json_object *region,
                        json_object **out)
{
    int rc;
    char s_uuid_str[37];
    json_object *j_state = json_object_new_object();
    json_object *j_name = json_object_new_string(state->name);
    json_object *j_kind;
    json_object *j_region = json_object_new_array();
    json_object *j_transitions = json_object_new_array();

    uuid_unparse(state->id, s_uuid_str);
    json_object *j_id = json_object_new_string(s_uuid_str);

    json_object *j_entries = json_object_new_array();
    json_object *j_exits = json_object_new_array();

    json_object_object_add(j_state, "id", j_id);
    json_object_object_add(j_state, "name", j_name);

    switch (state->kind) {
        case UFSMM_STATE_NORMAL:
            j_kind = json_object_new_string("state");
        break;
        case UFSMM_STATE_INIT:
            j_kind = json_object_new_string("init");
        break;
        case UFSMM_STATE_FINAL:
            j_kind = json_object_new_string("final");
        break;
        case UFSMM_STATE_SHALLOW_HISTORY:
            j_kind = json_object_new_string("shallow-history");
        break;
        case UFSMM_STATE_DEEP_HISTORY:
            j_kind = json_object_new_string("deep-history");
        break;
        case UFSMM_STATE_EXIT_POINT:
            j_kind = json_object_new_string("exit-point");
        break;
        case UFSMM_STATE_ENTRY_POINT:
            j_kind = json_object_new_string("entry-point");
        break;
        case UFSMM_STATE_JOIN:
            j_kind = json_object_new_string("join");
        break;
        case UFSMM_STATE_FORK:
            j_kind = json_object_new_string("fork");
        break;
        case UFSMM_STATE_CHOICE:
            j_kind = json_object_new_string("choice");
        break;
        case UFSMM_STATE_JUNCTION:
            j_kind = json_object_new_string("junction");
        break;
        case UFSMM_STATE_TERMINATE:
            j_kind = json_object_new_string("terminate");
        break;
        default:
            L_ERR("Unknown state type %i", state->kind);
            rc = -1;
            goto err_out;
    }


    json_object_object_add(j_state, "kind", j_kind);


    json_object_object_add(j_state, "width",
                json_object_new_double(state->w));

    json_object_object_add(j_state, "height",
                json_object_new_double(state->h));

    json_object_object_add(j_state, "x",
                json_object_new_double(state->x));
    json_object_object_add(j_state, "y",
                json_object_new_double(state->y));

    rc = serialize_action_list(&state->entries, j_entries);
    if (rc != UFSMM_OK)
        goto err_out;

    rc = serialize_action_list(&state->exits, j_exits);
    if (rc != UFSMM_OK)
        goto err_out;

    json_object_object_add(j_state, "entries", j_entries);
    json_object_object_add(j_state, "exits", j_exits);
    json_object_object_add(j_state, "region", j_region);

    /* Serialize transitions owned by this state */
    rc = ufsmm_transitions_serialize(state, j_transitions);

    if (rc != UFSMM_OK) {
        L_ERR("Could not serialize transitions");
        json_object_put(j_transitions);
        goto err_out;
    }

    json_object_object_add(j_state, "transitions", j_transitions);

    (*out) = j_state;

    json_object *j_region_state_array;

    if (!json_object_object_get_ex(region, "states", &j_region_state_array))
        return -UFSMM_ERROR;

    json_object_array_add(j_region_state_array, j_state);

    return UFSMM_OK;
err_out:
    json_object_put(j_state);
    return rc;
}

/* Translate json representation to the internal structure */
int ufsmm_state_deserialize(struct ufsmm_model *model,
                           json_object *j_state,
                           struct ufsmm_region *region,
                           struct ufsmm_state **out)
{
    int rc = UFSMM_OK;
    struct ufsmm_state *state;
    struct ufsmm_entry_exit *s_exit;
    struct ufsmm_entry_exit *s_entry;
    json_object *j_state_name;
    json_object *j_entries = NULL;
    json_object *k_entry_name = NULL;
    json_object *j_exits = NULL;
    json_object *j_entry = NULL;
    json_object *j_exit = NULL;
    json_object *j_id = NULL;
    json_object *j_state_kind = NULL;
    json_object *jobj;

    state = malloc(sizeof(struct ufsmm_state));
    memset(state, 0, sizeof(*state));

    TAILQ_INIT(&state->transitions);
    TAILQ_INIT(&state->entries);
    TAILQ_INIT(&state->exits);
    (*out) = state;

    if (!json_object_object_get_ex(j_state, "id", &j_id)) {
        L_ERR("Could not read ID");
        rc = -UFSMM_ERR_PARSE;
        goto err_out;
    }

    uuid_parse(json_object_get_string(j_id), state->id);

    if (!json_object_object_get_ex(j_state, "name", &j_state_name))
    {
        L_ERR("Missing name property, aborting");
        rc = -UFSMM_ERR_PARSE;
        goto err_out;
    }

    if (!json_object_object_get_ex(j_state, "kind", &j_state_kind))
    {
        L_ERR("Missing kind property, aborting");
        rc = -UFSMM_ERR_PARSE;
        goto err_out;
    }

    const char *state_kind = json_object_get_string(j_state_kind);

    if (strcmp(state_kind, "state") == 0) {
        state->kind = UFSMM_STATE_NORMAL;
        state->resizeable = true;
    } else if (strcmp(state_kind, "init") == 0) {
        state->kind = UFSMM_STATE_INIT;
    } else if (strcmp(state_kind, "final") == 0) {
        state->kind = UFSMM_STATE_FINAL;
    } else if (strcmp(state_kind, "shallow-history") == 0) {
        state->kind = UFSMM_STATE_SHALLOW_HISTORY;
    } else if (strcmp(state_kind, "deep-history") == 0) {
        state->kind = UFSMM_STATE_DEEP_HISTORY;
    } else if (strcmp(state_kind, "exit-point") == 0) {
        state->kind = UFSMM_STATE_EXIT_POINT;
    } else if (strcmp(state_kind, "entry-point") == 0) {
        state->kind = UFSMM_STATE_ENTRY_POINT;
    } else if (strcmp(state_kind, "join") == 0) {
        state->kind = UFSMM_STATE_JOIN;
        state->resizeable = true;
    } else if (strcmp(state_kind, "fork") == 0) {
        state->kind = UFSMM_STATE_FORK;
        state->resizeable = true;
    } else if (strcmp(state_kind, "choice") == 0) {
        state->kind = UFSMM_STATE_CHOICE;
        state->resizeable = true;
    } else if (strcmp(state_kind, "junction") == 0) {
        state->kind = UFSMM_STATE_JUNCTION;
    } else if (strcmp(state_kind, "terminate") == 0) {
        state->kind = UFSMM_STATE_TERMINATE;
    } else {
        L_ERR("Unknown state kind '%s'", state_kind);
        rc = -UFSMM_ERR_PARSE;
        goto err_out;
    }


    if (!json_object_object_get_ex(j_state, "x", &jobj))
        state->x = 0;
    else
        state->x = json_object_get_double(jobj);

    if (!json_object_object_get_ex(j_state, "y", &jobj))
        state->y = 0;
    else
        state->y = json_object_get_double(jobj);

    if (!json_object_object_get_ex(j_state, "width", &jobj))
        state->w = 0;
    else
        state->w = json_object_get_double(jobj);

    if (!json_object_object_get_ex(j_state, "height", &jobj))
        state->h = 0;
    else
        state->h = json_object_get_double(jobj);

    state->name = strdup(json_object_get_string(j_state_name));
    state->parent_region = region;

    if (json_object_object_get_ex(j_state, "entries", &j_entries)) {
        size_t n_entries = json_object_array_length(j_entries);
        L_DEBUG("State '%s' has %d entry actions", state->name, n_entries);

        for (int n = 0; n < n_entries; n++)
        {
            j_entry = json_object_array_get_idx(j_entries, n);
            json_object *j_entry_id;
            json_object *j_id;
            uuid_t entry_id;
            uuid_t id_uu;
            if (json_object_object_get_ex(j_entry, "action-id", &j_entry_id)) {
                json_object_object_get_ex(j_entry, "id", &j_id);
                uuid_parse(json_object_get_string(j_id), id_uu);
                uuid_parse(json_object_get_string(j_entry_id), entry_id);
                rc = ufsmm_state_add_entry(model, state, id_uu, entry_id);
                if (rc != UFSMM_OK)
                    goto err_free_name_out;
            }
        }
    }

    if (json_object_object_get_ex(j_state, "exits", &j_exits)) {
        size_t n_entries = json_object_array_length(j_exits);

        L_DEBUG("State '%s' has %d exit actions", state->name, n_entries);
        for (int n = 0; n < n_entries; n++)
        {
            j_exit = json_object_array_get_idx(j_exits, n);
            json_object *j_exit_id;
            json_object *j_id;
            uuid_t exit_id;
            uuid_t id_uu;
            if (json_object_object_get_ex(j_exit, "action-id", &j_exit_id)) {
                json_object_object_get_ex(j_exit, "id", &j_id);
                uuid_parse(json_object_get_string(j_id), id_uu);
                uuid_parse(json_object_get_string(j_exit_id), exit_id);
                rc = ufsmm_state_add_exit(model, state, id_uu, exit_id);
                if (rc != UFSMM_OK)
                    goto err_free_name_out;
            }
        }
    }

    /* NOTE: Transitions are loaded in pass 2 since the whole object tree
     *  must be available for state resolution in transitions */

    L_DEBUG("Loading state %s", state->name);

    return rc;
err_free_name_out:
    free((void *) state->name);
err_out:
    free_action_ref_list(&state->entries);
    free_action_ref_list(&state->exits);
    free(state);
    return rc;
}

int ufsmm_state_add_exit(struct ufsmm_model *model,
                        struct ufsmm_state *state,
                        uuid_t id,
                        uuid_t action_id)
{
    struct ufsmm_action *action;
    struct ufsmm_action_ref *action_ref;
    int rc;

    rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_ACTION, &action);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(action_id, uuid_str);
        L_ERR("Unkown exit action function %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding exit action '%s' to state '%s'", action->name, state->name);

    action_ref = malloc(sizeof(struct ufsmm_action_ref));
    memset(action_ref, 0, sizeof(*action_ref));
    action_ref->act = action;
    memcpy(action_ref->id, id, 16);

    TAILQ_INSERT_TAIL(&state->exits, action_ref, tailq);
    return UFSMM_OK;
}

int ufsmm_state_add_entry(struct ufsmm_model *model,
                         struct ufsmm_state *state,
                         uuid_t id,
                         uuid_t action_id)
{
    struct ufsmm_action *action;
    struct ufsmm_action_ref *action_ref;
    int rc;

    rc = ufsmm_model_get_action(model, action_id, UFSMM_ACTION_ACTION, &action);

    if (rc != UFSMM_OK) {
        char uuid_str[37];
        uuid_unparse(id, uuid_str);
        L_ERR("Unkown entry action function %s", uuid_str);
        return rc;
    }

    L_DEBUG("Adding entry action '%s' to state '%s'", action->name, state->name);

    action_ref = malloc(sizeof(struct ufsmm_action_ref));
    memset(action_ref, 0, sizeof(*action_ref));
    action_ref->act = action;
    memcpy(action_ref->id, id, 16);
    TAILQ_INSERT_TAIL(&state->entries, action_ref, tailq);
    return UFSMM_OK;
}

int ufsmm_state_delete_entry(struct ufsmm_state *state,
                            uuid_t id)
{
    return delete_action_ref(&state->entries, id);
}

int ufsmm_state_delete_exit(struct ufsmm_state *state,
                            uuid_t id)
{
    return delete_action_ref(&state->exits, id);
}

int ufsmm_state_add_transition(struct ufsmm_state *source,
                              struct ufsmm_state *dest,
                              struct ufsmm_transition *t)
{
    struct ufsmm_transition *t_tmp;

    t->source.state = source;
    t->dest.state = dest;

    TAILQ_INSERT_TAIL(&source->transitions, t, tailq);
    return UFSMM_OK;
}

int ufsmm_state_delete_transition(struct ufsmm_transition *transition)
{
    return ufsmm_transition_free_one(transition);
}

int ufsmm_state_move_to_region(struct ufsmm_model *model,
                               struct ufsmm_state *state,
                               struct ufsmm_region *new_region)
{
    /* Same as current pr, ignore */
    if (state->parent_region == new_region)
        return -UFSMM_ERROR;
    /* Ignore if target region is a decendant */
    if (ufsmm_state_contains_region(model, state, new_region))
        return -UFSMM_ERROR;

    /* Unlink from source region */
    if (state->parent_region->last_state == state) {
        L_DEBUG("Was last, update last_state");
        state->parent_region->last_state = state->prev;
    }

    if (state->prev == NULL) { /* First state in source region */
        L_DEBUG("First in source region");
        struct ufsmm_state *next = state->next;
        state->parent_region->state = next;

        if (next == NULL) {
            L_DEBUG("Source region is now empty");
            state->parent_region->last_state = NULL;
        } else {
            next->prev = NULL;
            L_DEBUG("state->next = '%s'", next->name);
        }
    } else {
        struct ufsmm_state *prev = state->prev;
        struct ufsmm_state *next = state->next;

        L_DEBUG("%p %p", prev, next);

        if (prev)
            L_DEBUG("state->prev = '%s'", prev->name);
        if (next)
            L_DEBUG("state->next = '%s'", next->name);

        state->prev->next = next;

        if (next) {
            state->next->prev = prev;
        }
    }

    /* Insert into new region */
    if (new_region->last_state) {
        new_region->last_state->next = state;
        state->prev = new_region->last_state;
        state->next = NULL;
        new_region->last_state = state;
    } else {
        new_region->last_state = state;
        new_region->state = state;
        state->prev = NULL;
        state->next = NULL;
    }

    state->parent_region = new_region;

    return UFSMM_OK;
}

bool ufsmm_state_contains_region(struct ufsmm_model *model,
                                 struct ufsmm_state *state,
                                 struct ufsmm_region *region)
{
    static struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    bool result = false;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    for (r = state->regions; r; r = r->next) {
        ufsmm_stack_push(stack, r);
    }

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK)
    {
        if (r == region) {
            result = true;
            break;
        }

        for (s = r->state; s; s = s->next) {
            for (r2 = s->regions; r2; r2 = r2->next) {
                ufsmm_stack_push(stack, r2);
            }
        }
    }

    ufsmm_stack_free(stack);
    return result;
}
