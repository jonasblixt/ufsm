#ifndef INCLUDE_UFSMM_MODEL_H_
#define INCLUDE_UFSMM_MODEL_H_

#include <stdarg.h>
#include <stdint.h>
#include <sys/queue.h>
#include <uuid/uuid.h>
#include <stdbool.h>
#include <json.h>

/* This sets the upper limit on how many regions a state can hold
 * and how many states a region can hold */
#define UFSMM_MAX_R_S 1024

/* This sets the total amount of states and regions that can be
 * allocated */
#define UFSMM_MAX_OBJECTS (1024*1024)

enum ufsmm_errors
{
    UFSMM_OK,
    UFSMM_ERROR,
    UFSMM_ERR_IO,
    UFSMM_ERR_MEM,
    UFSMM_ERR_PARSE,
};

enum ufsmm_debug_level
{
    UFSMM_L_ERROR,
    UFSMM_L_INFO,
    UFSMM_L_DEBUG,
};

#define L_INFO(...) \
         do { ufsmm_debug(1, __func__, __VA_ARGS__); } while (0)

#define L_DEBUG(...) \
         do { ufsmm_debug(2, __func__, __VA_ARGS__); } while (0)

#define L_ERR(...) \
         do { ufsmm_debug(0, __func__, __VA_ARGS__); } while (0)

struct ufsmm_stack
{
    size_t no_of_elements;
    size_t pos;
    void *data[];
};

enum ufsmm_transition_kind
{
    UFSMM_TRANSITION_EXTERNAL,
    UFSMM_TRANSITION_INTERNAL,
    UFSMM_TRANSITION_LOCAL,
};

enum ufsmm_state_kind
{
    UFSMM_STATE_NORMAL,
    UFSMM_STATE_INIT,
    UFSMM_STATE_FINAL,
    UFSMM_STATE_SHALLOW_HISTORY,
    UFSMM_STATE_DEEP_HISTORY,
    UFSMM_STATE_EXIT_POINT,
    UFSMM_STATE_ENTRY_POINT,
    UFSMM_STATE_JOIN,
    UFSMM_STATE_FORK,
    UFSMM_STATE_CHOICE,
    UFSMM_STATE_JUNCTION,
    UFSMM_STATE_TERMINATE,
};

enum ufsmm_action_kind
{
    UFSMM_ACTION_ACTION,
    UFSMM_ACTION_ENTRY,
    UFSMM_ACTION_EXIT,
    UFSMM_ACTION_GUARD,
};

enum ufsmm_side
{
    UFSMM_SIDE_NONE,
    UFSMM_SIDE_LEFT,
    UFSMM_SIDE_RIGHT,
    UFSMM_SIDE_TOP,
    UFSMM_SIDE_BOTTOM,
};

enum ufsmm_transition_vertice_kind
{
    UFSMM_TRANSITION_VERTICE_NONE,
    UFSMM_TRANSITION_VERTICE,
    UFSMM_TRANSITION_VERTICE_START,
    UFSMM_TRANSITION_VERTICE_END,
};

struct ufsmm_action
{
    uuid_t id;
    const char *name;
    enum ufsmm_action_kind kind;
    TAILQ_ENTRY(ufsmm_action) tailq;
};

TAILQ_HEAD(ufsmm_actions, ufsmm_action);

struct ufsmm_action_ref
{
    uuid_t id;
    bool focus;
    double x, y, w, h; /* Support variables for the canvas */
    struct ufsmm_action *act;
    TAILQ_ENTRY(ufsmm_action_ref) tailq;
};

TAILQ_HEAD(ufsmm_action_refs, ufsmm_action_ref);

struct ufsmm_trigger
{
    uuid_t id;
    const char *name;
    TAILQ_ENTRY(ufsmm_trigger) tailq;
};

TAILQ_HEAD(ufsmm_triggers, ufsmm_trigger);

struct ufsmm_vertice
{
    double x;
    double y;
    TAILQ_ENTRY(ufsmm_vertice) tailq;
};

TAILQ_HEAD(ufsmm_vertices, ufsmm_vertice);

struct ufsmm_transition_state_ref
{
    struct ufsmm_state *state;
    double offset;
    enum ufsmm_side side;
};

struct ufsmm_coords
{
    double x;
    double y;
    double w;
    double h;
};

struct ufsmm_transition_state_condition
{
    struct ufsmm_state *state;
    bool positive;
    TAILQ_ENTRY(ufsmm_transition_state_condition) tailq;
};

TAILQ_HEAD(ufsmm_transition_state_conditions, ufsmm_transition_state_condition);

struct ufsmm_transition
{
    uuid_t id;
    struct ufsmm_trigger *trigger;
    enum ufsmm_transition_kind kind;
    struct ufsmm_action_refs actions;
    struct ufsmm_action_refs guards;
    struct ufsmm_transition_state_ref source;
    struct ufsmm_transition_state_ref dest;
    struct ufsmm_coords text_block_coords;
    struct ufsmm_vertices vertices;
    struct ufsmm_transition_state_conditions state_conditions;
    bool focus;
    TAILQ_ENTRY(ufsmm_transition) tailq;
};

TAILQ_HEAD(ufsmm_transitions, ufsmm_transition);

TAILQ_HEAD(ufsmm_states, ufsmm_state);

struct ufsmm_region
{
    uuid_t id;
    const char *name;
    bool off_page;
    double h;
    bool focus;
    bool draw_as_root;
    unsigned int depth;
    double ox, oy;
    double scale;
    struct ufsmm_states states;
    struct ufsmm_state *parent_state;
    TAILQ_ENTRY(ufsmm_region) tailq;
};

TAILQ_HEAD(ufsmm_regions, ufsmm_region);

struct ufsmm_state
{
    uuid_t id;
    const char *name;
    double x;
    double y;
    double w;
    double h;
    double region_y_offset;
    bool focus;
    bool resizeable;
    unsigned int branch_concurrency_count;
    enum ufsmm_state_kind kind;
    struct ufsmm_transitions transitions;
    struct ufsmm_action_refs entries;
    struct ufsmm_action_refs exits;
    struct ufsmm_regions regions;
    struct ufsmm_region *parent_region;
    TAILQ_ENTRY(ufsmm_state) tailq;
};


struct ufsmm_model
{
    json_object *jroot;
    struct ufsmm_region *root;
    struct ufsmm_actions guards;  /* Global list of guard functions */
    struct ufsmm_actions actions; /* Global list of action functions */
    struct ufsmm_triggers triggers;
    const char *name;
    int version;
    unsigned int no_of_regions;
    unsigned int no_of_states;
    const char *filename;
};

int ufsmm_model_load(const char *filename, struct ufsmm_model **model);
int ufsmm_model_create(struct ufsmm_model **model, const char *name);
int ufsmm_model_write(const char *filename, struct ufsmm_model *model);
int ufsmm_model_free(struct ufsmm_model *model);
int ufsmm_model_add_action(struct ufsmm_model *model,
                          enum ufsmm_action_kind kind,
                          const char *name,
                          struct ufsmm_action **act);
int ufsmm_model_delete_action(struct ufsmm_model *model, uuid_t id);
int ufsmm_model_get_action(struct ufsmm_model *model, uuid_t id,
                          enum ufsmm_action_kind kind,
                          struct ufsmm_action **result);

int ufsmm_model_get_action_by_name(struct ufsmm_model *model,
                          const char *name,
                          enum ufsmm_action_kind kind,
                          struct ufsmm_action **result);

int ufsmm_model_add_trigger(struct ufsmm_model *model, const char *name,
                           struct ufsmm_trigger **out);
int ufsmm_model_delete_trigger(struct ufsmm_model *model, uuid_t id);
int ufsmm_model_get_trigger(struct ufsmm_model *model, uuid_t id,
                           struct ufsmm_trigger **out);

int ufsmm_model_deserialize_coords(json_object *j_coords,
                                  struct ufsmm_coords *coords);

int ufsmm_model_calculate_max_orthogonal_regions(struct ufsmm_model *model);
int ufsmm_model_calculate_nested_region_depth(struct ufsmm_model *model);
int ufsmm_model_calculate_max_transitions(struct ufsmm_model *model);
int ufsmm_model_calculate_max_concurrent_states(struct ufsmm_model *model);

struct ufsmm_state *ufsmm_model_get_state_from_uuid(struct ufsmm_model *model,
                                                  uuid_t id);

struct ufsmm_trigger * ufsmm_model_get_trigger_from_uuid(struct ufsmm_model *model,
                                                       uuid_t id);
int free_action_ref_list(struct ufsmm_action_refs *list);

int ufsmm_model_delete_region(struct ufsmm_model *model,
                              struct ufsmm_region *region);

int ufsmm_model_delete_state(struct ufsmm_model *model,
                             struct ufsmm_state *state);


int delete_action_ref(struct ufsmm_action_refs *list, uuid_t id);

/* Region api */
int ufsmm_add_region(struct ufsmm_state *state, bool off_page,
                     struct ufsmm_region **out);
int ufsmm_set_region_name(struct ufsmm_region *region, const char *name);

int ufsmm_region_append_state(struct ufsmm_region *r, struct ufsmm_state *state);

int ufsmm_region_serialize(struct ufsmm_region *region, json_object *state,
                         json_object **out);

int ufsmm_region_deserialize(json_object *j_r, struct ufsmm_state *state,
                            struct ufsmm_region **out);

int ufsmm_region_set_height(struct ufsmm_region *r, double h);
int ufsmm_region_get_height(struct ufsmm_region *r, double *h);

/* State api */

int ufsmm_add_state(struct ufsmm_region *region, const char *name,
                    struct ufsmm_state **out);

int ufsmm_state_add_entry(struct ufsmm_model *model,
                         struct ufsmm_state *state,
                         uuid_t id,
                         uuid_t action_id);

int ufsmm_state_add_exit(struct ufsmm_model *model,
                        struct ufsmm_state *state,
                        uuid_t id,
                        uuid_t action_id);

int ufsmm_state_delete_entry(struct ufsmm_state *state, uuid_t id);
int ufsmm_state_delete_exit(struct ufsmm_state *state, uuid_t id);

int ufsmm_state_add_transition(struct ufsmm_state *source,
                              struct ufsmm_state *dest,
                              struct ufsmm_transition *transition);

int ufsmm_state_delete_transition(struct ufsmm_transition *transition);

int ufsmm_state_append_region(struct ufsmm_state *state, struct ufsmm_region *r);

int ufsmm_state_serialize(struct ufsmm_state *state, json_object *region,
                        json_object **out);

int ufsmm_state_deserialize(struct ufsmm_model *model,
                           json_object *j_state,
                           struct ufsmm_region *region,
                           struct ufsmm_state **out);

int ufsmm_state_set_size(struct ufsmm_state *s, double x, double y);
int ufsmm_state_set_xy(struct ufsmm_state *s, double x, double y);

int ufsmm_state_get_size(struct ufsmm_state *s, double *x, double *y);
int ufsmm_state_get_xy(struct ufsmm_state *s, double *x, double *y);

bool ufsmm_state_contains_region(struct ufsmm_model *model,
                                 struct ufsmm_state *state,
                                 struct ufsmm_region *region);

int ufsmm_state_move_to_region(struct ufsmm_model *model,
                               struct ufsmm_state *state,
                               struct ufsmm_region *new_region);

const char * ufsmm_model_name(struct ufsmm_model *model);

/* Transition API */
int ufsmm_transition_deserialize(struct ufsmm_model *model,
                                struct ufsmm_state *state,
                                json_object *j_object);

int ufsmm_transitions_serialize(struct ufsmm_state *state,
                              json_object *j_output);

int ufsmm_transition_set_trigger(struct ufsmm_model *model,
                                struct ufsmm_transition *transition,
                                struct ufsmm_trigger *trigger);

int ufsmm_transition_add_guard(struct ufsmm_model *model,
                              struct ufsmm_transition *transition,
                              uuid_t id,
                              uuid_t action_id);

int ufsmm_transition_delete_guard(struct ufsmm_transition *transition, uuid_t id);

int ufsmm_transition_add_action(struct ufsmm_model *model,
                               struct ufsmm_transition *transition,
                               uuid_t id,
                               uuid_t action_id);

int ufsmm_transition_delete_action(struct ufsmm_transition *transition, uuid_t id);

int ufsmm_transition_add_state_condition(struct ufsmm_model *model,
                                        struct ufsmm_transition *transition,
                                        uuid_t id,
                                        bool positive);

int ufsmm_transition_delete_state_condition(struct ufsmm_transition *transition,
                                            uuid_t id);
int ufsmm_transition_new(struct ufsmm_transition **transition);
int ufsmm_transition_free_one(struct ufsmm_transition *transition);

int ufsmm_transition_change_src_state(struct ufsmm_transition *transition,
                                      struct ufsmm_state *new_state);
int ufsmm_transition_free(struct ufsmm_transitions *transitions);

/* Misc model library stuff */

int ufsmm_debug(enum ufsmm_debug_level debug_level, const char *func_name,
                    const char *fmt, ...);

const char *ufsmm_library_version(void);

/* uFSM Model stack API */

int ufsmm_stack_init(struct ufsmm_stack **stack, size_t no_of_elements);
int ufsmm_stack_free(struct ufsmm_stack *stack);
int ufsmm_stack_push(struct ufsmm_stack *stack, void *item);
int ufsmm_stack_pop(struct ufsmm_stack *stack, void **item);

#endif  // INCLUDE_UFSMM_MODEL_H_
