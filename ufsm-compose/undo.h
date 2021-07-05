#ifndef UFSMM_UNDO_H
#define UFSMM_UNDO_H

#include <ufsm/model.h>

enum ufsmm_undo_op_kind {
    UFSMM_UNDO_RENAME_STATE,
    UFSMM_UNDO_RESIZE_STATE,
};

struct ufsmm_undo_rename_state {
    struct ufsmm_state *state;
    const char *new_name;
    const char *old_name;
};

struct ufsmm_undo_resize_state {
    struct ufsmm_state *state;
    double nx, ny, nw, nh;
    double ox, oy, ow, oh;
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
                        struct ufsmm_undo_ops *ops);

int ufsmm_undo_rename_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state,
                            const char *old_name);
int ufsmm_undo_resize_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state);
#endif
