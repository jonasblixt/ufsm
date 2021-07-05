#include <string.h>
#include <ufsm/model.h>
#include "undo.h"

struct ufsmm_undo_context *ufsmm_undo_init(struct ufsmm_model *model)
{
    struct ufsmm_undo_context *new = malloc(sizeof(struct ufsmm_undo_context));

    if (new == NULL)
        return NULL;

    memset(new, 0, sizeof(*new));
    new->model = model;
    TAILQ_INIT(&new->undo_stack);
    TAILQ_INIT(&new->redo_stack);
    return new;
}

void ufsmm_undo_free(struct ufsmm_undo_context *undo)
{
    free(undo);
}

int ufsmm_undo(struct ufsmm_undo_context *undo)
{
    struct ufsmm_undo_ops_ref *ops_ref;

    ops_ref = TAILQ_LAST(&undo->undo_stack, ufsmm_undo_list);

    if (ops_ref == NULL) {
        L_DEBUG("Noting more to undo");
        return -1;
    }

    /* Move to redo stack */
    TAILQ_REMOVE(&undo->undo_stack, ops_ref, tailq);
    TAILQ_INSERT_TAIL(&undo->redo_stack, ops_ref, tailq);

    struct ufsmm_undo_ops *ops = ops_ref->ops;
    struct ufsmm_undo_op *op;

    TAILQ_FOREACH_REVERSE(op, ops, ufsmm_undo_ops, tailq) {
        switch (op->kind) {
            case UFSMM_UNDO_RENAME_STATE:
            {
                struct ufsmm_undo_rename_state *rename_op =
                        (struct ufsmm_undo_rename_state *) op->data;
                free((void *) rename_op->state->name);
                rename_op->state->name = strdup(rename_op->old_name);
            }
            break;
            case UFSMM_UNDO_RESIZE_STATE:
            {
                struct ufsmm_undo_resize_state *resize_op =
                        (struct ufsmm_undo_resize_state *) op->data;
                resize_op->state->x = resize_op->ox;
                resize_op->state->y = resize_op->oy;
                resize_op->state->w = resize_op->ow;
                resize_op->state->h = resize_op->oh;
            }
            break;
        }
    }
}

int ufsmm_redo(struct ufsmm_undo_context *undo)
{
    struct ufsmm_undo_ops_ref *ops_ref;

    ops_ref = TAILQ_LAST(&undo->redo_stack, ufsmm_undo_list);

    if (ops_ref == NULL) {
        L_DEBUG("Noting more to redo");
        return -1;
    }

    /* Move back to undo stack */
    TAILQ_REMOVE(&undo->redo_stack, ops_ref, tailq);
    TAILQ_INSERT_TAIL(&undo->undo_stack, ops_ref, tailq);

    struct ufsmm_undo_ops *ops = ops_ref->ops;
    struct ufsmm_undo_op *op;

    TAILQ_FOREACH_REVERSE(op, ops, ufsmm_undo_ops, tailq) {
        switch (op->kind) {
            case UFSMM_UNDO_RENAME_STATE:
            {
                struct ufsmm_undo_rename_state *rename_op =
                        (struct ufsmm_undo_rename_state *) op->data;
                free((void *) rename_op->state->name);
                rename_op->state->name = strdup(rename_op->new_name);
            }
            break;
            case UFSMM_UNDO_RESIZE_STATE:
            {
                struct ufsmm_undo_resize_state *resize_op =
                        (struct ufsmm_undo_resize_state *) op->data;
                resize_op->state->x = resize_op->nx;
                resize_op->state->y = resize_op->ny;
                resize_op->state->w = resize_op->nw;
                resize_op->state->h = resize_op->nh;
            }
            break;
        }
    }
}

struct ufsmm_undo_ops *ufsmm_undo_new_ops(void)
{
    struct ufsmm_undo_ops *new = malloc(sizeof(struct ufsmm_undo_ops));
    if (new == NULL)
        return NULL;
    memset(new, 0, sizeof(*new));
    TAILQ_INIT(new);
    return new;
}

int ufsmm_undo_commit_ops(struct ufsmm_undo_context *undo,
                          struct ufsmm_undo_ops *ops)
{
    struct ufsmm_undo_ops_ref *new = malloc(sizeof(struct ufsmm_undo_ops_ref));

    if (new == NULL)
        return -1;
    memset(new, 0, sizeof(*new));
    new->ops = ops;

    TAILQ_INSERT_TAIL(&undo->undo_stack, new, tailq);
    return 0;
}

int ufsmm_undo_free_ops(struct ufsmm_undo_context *undo,
                        struct ufsmm_undo_ops *ops)
{
}

int ufsmm_undo_rename_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state,
                            const char *old_name)
{
    int rc = 0;
    struct ufsmm_undo_rename_state *data = \
                       malloc(sizeof(struct ufsmm_undo_rename_state));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = malloc(sizeof(struct ufsmm_undo_op));

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    memset(op, 0, sizeof(*op));

    data->state = state;
    data->new_name = strdup(state->name);
    data->old_name = strdup(old_name);
    op->data = data;
    op->kind = UFSMM_UNDO_RENAME_STATE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_resize_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state)
{
    int rc = 0;
    struct ufsmm_undo_resize_state *data = \
                       malloc(sizeof(struct ufsmm_undo_resize_state));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = malloc(sizeof(struct ufsmm_undo_op));

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    memset(op, 0, sizeof(*op));

    data->state = state;
    data->nx = state->x;
    data->ny = state->y;
    data->nw = state->w;
    data->nh = state->h;
    data->ox = state->tx;
    data->oy = state->ty;
    data->ow = state->tw;
    data->oh = state->th;
    op->data = data;
    op->kind = UFSMM_UNDO_RESIZE_STATE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}
