#ifndef UFSMM_UNDO_H
#define UFSMM_UNDO_H

#include <ufsm/model.h>

enum ufsmm_undo_op_kind {
    UFSMM_UNDO_RENAME_STATE,
    UFSMM_UNDO_RENAME_REGION,
    UFSMM_UNDO_RESIZE_STATE,
    UFSMM_UNDO_RESIZE_REGION,
    UFSMM_UNDO_MOVE_TRANSITION,
    UFSMM_UNDO_MOVE_VERTICE,
    UFSMM_UNDO_MOVE_COORDS,
    UFSMM_UNDO_ADD_STATE,
    UFSMM_UNDO_ADD_REGION,
    UFSMM_UNDO_ADD_TRANSITION,
    UFSMM_UNDO_ADD_GUARD,
    UFSMM_UNDO_ADD_AREF,
    UFSMM_UNDO_ADD_VERTICE,
    UFSMM_UNDO_REORDER_GUARD,
    UFSMM_UNDO_REORDER_AREF,
    UFSMM_UNDO_DELETE_GUARD,
    UFSMM_UNDO_DELETE_AREF,
    UFSMM_UNDO_DELETE_TRANSITION,
    UFSMM_UNDO_DELETE_STATE,
    UFSMM_UNDO_DELETE_REGION,
};

struct ufsmm_undo_op {
    enum ufsmm_undo_op_kind kind;
    void *data;
    TAILQ_ENTRY(ufsmm_undo_op) tailq;
};
TAILQ_HEAD(ufsmm_undo_ops, ufsmm_undo_op);

struct ufsmm_undo_ops_ref {
    struct ufsmm_undo_ops *ops;
    TAILQ_ENTRY(ufsmm_undo_ops_ref) tailq;
};
TAILQ_HEAD(ufsmm_undo_list, ufsmm_undo_ops_ref);

struct ufsmm_undo_context {
    struct ufsmm_model *model;
    struct ufsmm_undo_list undo_stack;
    struct ufsmm_undo_list redo_stack;
};

struct ufsmm_undo_context *ufsmm_undo_init(struct ufsmm_model *model);
void ufsmm_undo_free(struct ufsmm_undo_context *undo);

int ufsmm_undo(struct ufsmm_undo_context *undo);
int ufsmm_redo(struct ufsmm_undo_context *undo);

struct ufsmm_undo_ops *ufsmm_undo_new_ops(void);
int ufsmm_undo_commit_ops(struct ufsmm_undo_context *undo,
                          struct ufsmm_undo_ops *ops);
int ufsmm_undo_free_ops(struct ufsmm_undo_context *undo,
                        struct ufsmm_undo_ops *ops,
                        bool purge);

/* UNDO operations */

int ufsmm_undo_rename_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state,
                            const char *old_name);

int ufsmm_undo_rename_region(struct ufsmm_undo_ops *ops,
                            struct ufsmm_region *state,
                            const char *old_name);

int ufsmm_undo_resize_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state);

int ufsmm_undo_resize_region(struct ufsmm_undo_ops *ops,
                            struct ufsmm_region *region);

int ufsmm_undo_move_vertice(struct ufsmm_undo_ops *ops,
                            struct ufsmm_vertice *v);
int ufsmm_undo_move_coords(struct ufsmm_undo_ops *ops,
                            struct ufsmm_coords *coords);

int ufsmm_undo_move_transition_source(struct ufsmm_undo_ops *ops,
                                     struct ufsmm_transition *transition,
                                     struct ufsmm_transition_state_ref *old_ref);

int ufsmm_undo_move_transition_dest(struct ufsmm_undo_ops *ops,
                                     struct ufsmm_transition *transition,
                                     struct ufsmm_transition_state_ref *old_ref);
int ufsmm_undo_add_state(struct ufsmm_undo_ops *ops,
                         struct ufsmm_state *state);

int ufsmm_undo_add_region(struct ufsmm_undo_ops *ops,
                         struct ufsmm_region *region);

int ufsmm_undo_add_guard(struct ufsmm_undo_ops *ops,
                         struct ufsmm_transition *transition,
                         struct ufsmm_guard_ref *gref);

int ufsmm_undo_add_aref(struct ufsmm_undo_ops *ops,
                         struct ufsmm_action_refs *list,
                         struct ufsmm_action_ref *aref);

int ufsmm_undo_add_transition(struct ufsmm_undo_ops *ops,
                                 struct ufsmm_transition *transition);

int ufsmm_undo_add_vertice(struct ufsmm_undo_ops *ops,
                         struct ufsmm_transition *transition,
                         struct ufsmm_vertice *vertice,
                         struct ufsmm_vertice *prev,
                         struct ufsmm_vertice *next);

int ufsmm_undo_reorder_guard(struct ufsmm_undo_ops *ops,
                             struct ufsmm_transition *transition,
                             struct ufsmm_guard_ref *guard,
                             struct ufsmm_guard_ref *old_prev,
                             struct ufsmm_guard_ref *old_next);

int ufsmm_undo_reorder_aref(struct ufsmm_undo_ops *ops,
                             struct ufsmm_action_refs *list,
                             struct ufsmm_action_ref *aref,
                             struct ufsmm_action_ref *old_prev,
                             struct ufsmm_action_ref *old_next);

int ufsmm_undo_delete_guard(struct ufsmm_undo_ops *ops,
                             struct ufsmm_transition *transition,
                             struct ufsmm_guard_ref *guard);

int ufsmm_undo_delete_aref(struct ufsmm_undo_ops *ops,
                             struct ufsmm_action_refs *list,
                             struct ufsmm_action_ref *action);

int ufsmm_undo_delete_transition(struct ufsmm_undo_ops *ops,
                                 struct ufsmm_transition *transition);

int ufsmm_undo_delete_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state);

int ufsmm_undo_delete_region(struct ufsmm_undo_ops *ops,
                             struct ufsmm_region *region);
#endif
