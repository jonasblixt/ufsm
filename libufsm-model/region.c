#include <stdio.h>
#include <string.h>
#include <ufsm/model.h>
#include <json.h>


int ufsmm_add_region(struct ufsmm_state *state, bool off_page,
                     struct ufsmm_region **out)
{
    struct ufsmm_region *region = malloc(sizeof(struct ufsmm_region));

    if (!region)
        return -UFSMM_ERR_MEM;

    memset(region, 0, sizeof(*region));
    TAILQ_INIT(&region->states);

    region->parent_state = state;

    (*out) = region;

    uuid_generate_random(region->id);

    if (state->last_region) {
        region->prev = state->last_region;
        state->last_region->next = region;
    }

    if (!state->regions) {
        state->regions = region;
        region->h = -1;
    } else {
        region->h = 40;
    }

    state->last_region = region;

    return UFSMM_OK;
}

int ufsmm_set_region_name(struct ufsmm_region *region, const char *name)
{
    region->name = strdup(name);
    return UFSMM_OK;
}

int ufsmm_region_append_state(struct ufsmm_region *r, struct ufsmm_state *state)
{
    TAILQ_INSERT_TAIL(&r->states, state, tailq);
    return UFSMM_OK;
}

int ufsmm_region_set_height(struct ufsmm_region *r, double h)
{
    r->h = h;
    return UFSMM_OK;
}

int ufsmm_region_get_height(struct ufsmm_region *r, double *h)
{
    (*h) = r->h;
    return UFSMM_OK;
}

/* Translate the internal structure to json */
int ufsmm_region_serialize(struct ufsmm_region *region, json_object *state,
                         json_object **out)
{
    char r_uuid_str[37];
    json_object *j_region = json_object_new_object();
    json_object *j_name;
    json_object *j_offpage = json_object_new_boolean(region->off_page);
    json_object *j_states = json_object_new_array();

    if (region->name != NULL)
        j_name = json_object_new_string(region->name);
    else
        j_name = json_object_new_string("");

    uuid_unparse(region->id, r_uuid_str);
    json_object *j_id = json_object_new_string(r_uuid_str);


    json_object_object_add(j_region, "id", j_id);
    json_object_object_add(j_region, "name", j_name);
    json_object_object_add(j_region, "off_page", j_offpage);
    json_object_object_add(j_region, "height",
                json_object_new_int(region->h));

    json_object_object_add(j_region, "states", j_states);

    if (state)
    {

        json_object *j_state_region_array;

        if (!json_object_object_get_ex(state, "region", &j_state_region_array))
            return -UFSMM_ERROR;

        json_object_array_add(j_state_region_array, j_region);
    }

    (*out) = j_region;

    return UFSMM_OK;
}

/* Translate json representation to the internal structure */
int ufsmm_region_deserialize(json_object *j_r, struct ufsmm_state *state,
                            struct ufsmm_region **out)
{
    json_object *jobj;
    json_object *j_id;
    struct ufsmm_region *r;

    r = malloc(sizeof(struct ufsmm_region));
    memset(r, 0, sizeof(*r));
    TAILQ_INIT(&r->states);

    (*out) = r;


    if (!json_object_object_get_ex(j_r, "name", &jobj))
    {
        L_INFO("Could not read name property");
        r->name = strdup("No name");
    }
    else
    {
        r->name = strdup(json_object_get_string(jobj));
    }

    if (!json_object_object_get_ex(j_r, "height", &jobj))
        r->h = 0.0;
    else
        r->h = json_object_get_double(jobj);

    if (!json_object_object_get_ex(j_r, "off_page", &jobj)) {
        r->off_page = false;
    } else {
        r->off_page = json_object_get_boolean(jobj);
    }

    if (!json_object_object_get_ex(j_r, "id", &j_id)) {
        L_ERR("Could not read id");
        return -UFSMM_ERROR;
    }

    uuid_parse(json_object_get_string(j_id), r->id);

    r->parent_state = state;

    if (state) {
        r->depth = state->parent_region->depth + 1;
    }

    return UFSMM_OK;
}
