#include <string.h>
#include <ufsm/model.h>
#include "undo.h"
#include "status.h"

struct ufsmm_undo_rename_state {

    struct ufsmm_state *state;
    const char *new_name;
    const char *old_name;
};

struct ufsmm_undo_rename_region {
    struct ufsmm_region *region;
    const char *new_name;
    const char *old_name;
};

struct ufsmm_undo_resize_state {
    struct ufsmm_state *state;
    double nx, ny, nw, nh;
    double ox, oy, ow, oh;
    enum ufsmm_orientation norientation, oorientation;
    struct ufsmm_region *oparent_region, *nparent_region;
};

struct ufsmm_undo_resize_region {
    struct ufsmm_region *region;
    double oh, nh;
};

struct ufsmm_undo_reorder_guard {
    struct ufsmm_transition *transition;
    struct ufsmm_guard_ref *guard;
    struct ufsmm_guard_ref *oprev, *onext, *nprev, *nnext;
};

struct ufsmm_undo_reorder_aref {
    struct ufsmm_action_refs *list;
    struct ufsmm_action_ref *aref;
    struct ufsmm_action_ref *oprev, *onext, *nprev, *nnext;
};

struct ufsmm_undo_move_vertice {
    struct ufsmm_vertice *vertice;
    double nx, ny;
    double ox, oy;
};

struct ufsmm_undo_move_coords {
    struct ufsmm_coords *coords;
    double nx, ny, nw, nh;
    double ox, oy, ow, oh;
};

struct ufsmm_undo_move_transition {
    struct ufsmm_transition *transition;
    bool is_source;
    struct ufsmm_transition_state_ref old_ref;
    struct ufsmm_transition_state_ref new_ref;
};

struct ufsmm_undo_add_state {
    struct ufsmm_state *state;
};

struct ufsmm_undo_add_region {
    struct ufsmm_region *region;
};

struct ufsmm_undo_add_transition {
    struct ufsmm_transition *transition;
};

struct ufsmm_undo_add_guard {
    struct ufsmm_transition *transition;
    struct ufsmm_guard_ref *guard;
};

struct ufsmm_undo_add_aref {
    struct ufsmm_action_refs *list;
    struct ufsmm_action_ref *aref;
};

struct ufsmm_undo_add_vertice {
    struct ufsmm_transition *transition;
    struct ufsmm_vertice *vertice, *prev, *next;
};

struct ufsmm_undo_delete_guard {
    struct ufsmm_transition *transition;
    struct ufsmm_guard_ref *guard, *next, *prev;
};

struct ufsmm_undo_delete_aref {
    struct ufsmm_action_refs *list;
    struct ufsmm_action_ref *aref, *next, *prev;
};

struct ufsmm_undo_delete_transition {
    struct ufsmm_transition *transition;
};

struct ufsmm_undo_delete_state {
    struct ufsmm_state *state;
};

struct ufsmm_undo_delete_region {
    struct ufsmm_region *region;
};

struct ufsmm_undo_set_trigger {
    struct ufsmm_transition *transition;
    struct ufsmm_trigger *old_trigger;
    enum ufsmm_trigger_kind old_kind;
    struct ufsmm_trigger *new_trigger;
    enum ufsmm_trigger_kind new_kind;
};

struct ufsmm_undo_toggle_off_page {
    struct ufsmm_region *region;
    bool new_value;
    bool old_value;
};

static struct ufsmm_undo_op* new_undo_op(void)
{
    struct ufsmm_undo_op *op = malloc(sizeof(struct ufsmm_undo_op));

    if (op == NULL) {
        return NULL;
    }

    memset(op, 0, sizeof(*op));
    return op;
}

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
    L_DEBUG("Freeing undo/redo stacks");
    /* Clear undo stack */
    struct ufsmm_undo_ops_ref *item;
    while ((item = TAILQ_FIRST(&undo->undo_stack))) {
        TAILQ_REMOVE(&undo->undo_stack, item, tailq);
        ufsmm_undo_free_ops(undo, item->ops, true);
        free(item);
    }

    /* Clear redo stack */
    while ((item = TAILQ_FIRST(&undo->redo_stack))) {
        TAILQ_REMOVE(&undo->redo_stack, item, tailq);
        ufsmm_undo_free_ops(undo, item->ops, false);
        free(item);
    }
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

    uc_rstatus_set(true);
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
            case UFSMM_UNDO_RENAME_REGION:
            {
                struct ufsmm_undo_rename_region *rename_op =
                        (struct ufsmm_undo_rename_region *) op->data;
                free((void *) rename_op->region->name);
                rename_op->region->name = strdup(rename_op->old_name);
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
                resize_op->state->orientation = resize_op->oorientation;

                if (resize_op->oparent_region != resize_op->nparent_region) {
                    TAILQ_REMOVE(&resize_op->nparent_region->states,
                                 resize_op->state,
                                 tailq);
                    TAILQ_INSERT_TAIL(&resize_op->oparent_region->states,
                                      resize_op->state,
                                      tailq);
                    resize_op->state->parent_region = resize_op->oparent_region;
                }
            }
            break;
            case UFSMM_UNDO_RESIZE_REGION:
            {
                struct ufsmm_undo_resize_region *resize_op =
                        (struct ufsmm_undo_resize_region *) op->data;
                resize_op->region->h = resize_op->oh;
            }
            break;
            case UFSMM_UNDO_MOVE_VERTICE:
            {
                struct ufsmm_undo_move_vertice *move_op =
                        (struct ufsmm_undo_move_vertice *) op->data;
                move_op->vertice->x = move_op->ox;
                move_op->vertice->y = move_op->oy;
            }
            break;
            case UFSMM_UNDO_MOVE_COORDS:
            {
                struct ufsmm_undo_move_coords *move_op =
                        (struct ufsmm_undo_move_coords *) op->data;
                move_op->coords->x = move_op->ox;
                move_op->coords->y = move_op->oy;
                move_op->coords->w = move_op->ow;
                move_op->coords->h = move_op->oh;
            }
            break;
            case UFSMM_UNDO_MOVE_TRANSITION:
            {
                struct ufsmm_undo_move_transition *move_op =
                        (struct ufsmm_undo_move_transition *) op->data;

                if (move_op->is_source) {
                    if (move_op->transition->source.state != move_op->old_ref.state) {
                        TAILQ_REMOVE(&move_op->new_ref.state->transitions,
                                     move_op->transition, tailq);
                        TAILQ_INSERT_TAIL(&move_op->old_ref.state->transitions,
                                            move_op->transition, tailq);
                        move_op->transition->source.state = move_op->old_ref.state;
                    }
                    move_op->transition->source.offset = move_op->old_ref.offset;
                    move_op->transition->source.side = move_op->old_ref.side;
                } else {
                    move_op->transition->dest.state = move_op->old_ref.state;
                    move_op->transition->dest.offset = move_op->old_ref.offset;
                    move_op->transition->dest.side = move_op->old_ref.side;
                }
            }
            break;
            case UFSMM_UNDO_ADD_STATE:
            {
                struct ufsmm_undo_add_state *add_op =
                        (struct ufsmm_undo_add_state *) op->data;
                L_DEBUG("Removing state '%s'", add_op->state->name);
                TAILQ_REMOVE(&add_op->state->parent_region->states,
                             add_op->state, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_REGION:
            {
                struct ufsmm_undo_add_region *add_op =
                        (struct ufsmm_undo_add_region *) op->data;

                L_DEBUG("Removing region '%s'", add_op->region->name);
                TAILQ_REMOVE(&add_op->region->parent_state->regions,
                             add_op->region, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_TRANSITION:
            {
                struct ufsmm_undo_add_transition *add_op =
                        (struct ufsmm_undo_add_transition *) op->data;

                L_DEBUG("Removing transition '%s->%s'",
                            add_op->transition->source.state->name,
                            add_op->transition->dest.state->name);
                TAILQ_REMOVE(&add_op->transition->source.state->transitions,
                             add_op->transition, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_GUARD:
            {
                struct ufsmm_undo_add_guard *add_op =
                        (struct ufsmm_undo_add_guard *) op->data;

                TAILQ_REMOVE(&add_op->transition->guards,
                             add_op->guard, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_AREF:
            {
                struct ufsmm_undo_add_aref *add_op =
                        (struct ufsmm_undo_add_aref *) op->data;

                TAILQ_REMOVE(add_op->list,
                             add_op->aref, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_VERTICE:
            {
                struct ufsmm_undo_add_vertice *add_op =
                        (struct ufsmm_undo_add_vertice *) op->data;

                TAILQ_REMOVE(&add_op->transition->vertices,
                             add_op->vertice, tailq);
            }
            break;
            case UFSMM_UNDO_REORDER_GUARD:
            {
                struct ufsmm_undo_reorder_guard *reorder_op =
                        (struct ufsmm_undo_reorder_guard *) op->data;
                if (reorder_op->oprev != NULL) {
                    TAILQ_REMOVE(&reorder_op->transition->guards,
                                 reorder_op->guard, tailq);
                    TAILQ_INSERT_AFTER(&reorder_op->transition->guards,
                                       reorder_op->oprev,
                                       reorder_op->guard, tailq);
                } else if (reorder_op->onext != NULL) {
                    TAILQ_REMOVE(&reorder_op->transition->guards,
                                 reorder_op->guard, tailq);
                    TAILQ_INSERT_BEFORE(reorder_op->onext,
                                       reorder_op->guard, tailq);
                }
            }
            break;
            case UFSMM_UNDO_REORDER_AREF:
            {
                struct ufsmm_undo_reorder_aref *reorder_op =
                        (struct ufsmm_undo_reorder_aref *) op->data;
                if (reorder_op->oprev != NULL) {
                    TAILQ_REMOVE(reorder_op->list,
                                 reorder_op->aref, tailq);
                    TAILQ_INSERT_AFTER(reorder_op->list,
                                       reorder_op->oprev,
                                       reorder_op->aref, tailq);
                } else if (reorder_op->onext != NULL) {
                    TAILQ_REMOVE(reorder_op->list,
                                 reorder_op->aref, tailq);
                    TAILQ_INSERT_BEFORE(reorder_op->onext,
                                       reorder_op->aref, tailq);
                }
            }
            break;
            case UFSMM_UNDO_DELETE_GUARD:
            {
                struct ufsmm_undo_delete_guard *delete_op =
                        (struct ufsmm_undo_delete_guard *) op->data;
                if (delete_op->prev != NULL) {
                    TAILQ_INSERT_AFTER(&delete_op->transition->guards,
                                       delete_op->prev,
                                       delete_op->guard, tailq);
                } else if (delete_op->next != NULL) {
                    TAILQ_INSERT_BEFORE(delete_op->next,
                                       delete_op->guard, tailq);
                } else {
                    TAILQ_INSERT_TAIL(&delete_op->transition->guards,
                                      delete_op->guard, tailq);
                }
            }
            break;
            case UFSMM_UNDO_DELETE_AREF:
            {
                struct ufsmm_undo_delete_aref *delete_op =
                        (struct ufsmm_undo_delete_aref *) op->data;
                if (delete_op->prev != NULL) {
                    TAILQ_INSERT_AFTER(delete_op->list,
                                       delete_op->prev,
                                       delete_op->aref, tailq);
                } else if (delete_op->next != NULL) {
                    TAILQ_INSERT_BEFORE(delete_op->next,
                                       delete_op->aref, tailq);
                } else {
                    TAILQ_INSERT_TAIL(delete_op->list,
                                      delete_op->aref, tailq);
                }
            }
            break;
            case UFSMM_UNDO_DELETE_TRANSITION:
            {
                struct ufsmm_undo_delete_transition *delete_op = \
                     (struct ufsmm_undo_delete_transition *) op->data;
                TAILQ_INSERT_TAIL(&delete_op->transition->source.state->transitions,
                                  delete_op->transition, tailq);

            }
            break;
            case UFSMM_UNDO_DELETE_STATE:
            {
                struct ufsmm_undo_delete_state *delete_op = \
                     (struct ufsmm_undo_delete_state *) op->data;
                TAILQ_INSERT_TAIL(&delete_op->state->parent_region->states,
                                  delete_op->state, tailq);

            }
            break;
            case UFSMM_UNDO_DELETE_REGION:
            {
                struct ufsmm_undo_delete_region *delete_op = \
                     (struct ufsmm_undo_delete_region *) op->data;

                if (delete_op->region->parent_state) {
                    struct ufsmm_state *state = delete_op->region->parent_state;
                    TAILQ_INSERT_TAIL(&state->regions,
                                  delete_op->region, tailq);
                }

            }
            break;
            case UFSMM_UNDO_SET_TRIGGER:
            {
                struct ufsmm_undo_set_trigger *set_op = \
                    (struct ufsmm_undo_set_trigger *) op->data;

                set_op->transition->trigger = set_op->old_trigger;
                set_op->transition->trigger_kind = set_op->old_kind;
            }
            break;
            case UFSMM_UNDO_TOGGLE_OFF_PAGE:
            {
                struct ufsmm_undo_toggle_off_page *set_op = \
                    (struct ufsmm_undo_toggle_off_page *) op->data;

                set_op->region->off_page = set_op->old_value;
            }
            break;
        }
    }
    return 0;
}

int ufsmm_redo(struct ufsmm_undo_context *undo)
{
    struct ufsmm_undo_ops_ref *ops_ref;

    ops_ref = TAILQ_LAST(&undo->redo_stack, ufsmm_undo_list);

    if (ops_ref == NULL) {
        L_DEBUG("Noting more to redo");
        return -1;
    }

    uc_rstatus_set(true);

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
            case UFSMM_UNDO_RENAME_REGION:
            {
                struct ufsmm_undo_rename_region *rename_op =
                        (struct ufsmm_undo_rename_region *) op->data;
                free((void *) rename_op->region->name);
                rename_op->region->name = strdup(rename_op->new_name);
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
                resize_op->state->orientation = resize_op->norientation;

                if (resize_op->oparent_region != resize_op->nparent_region) {
                    TAILQ_REMOVE(&resize_op->oparent_region->states,
                                 resize_op->state,
                                 tailq);
                    TAILQ_INSERT_TAIL(&resize_op->nparent_region->states,
                                      resize_op->state,
                                      tailq);
                    resize_op->state->parent_region = resize_op->nparent_region;
                }
            }
            break;
            case UFSMM_UNDO_RESIZE_REGION:
            {
                struct ufsmm_undo_resize_region *resize_op =
                        (struct ufsmm_undo_resize_region *) op->data;
                resize_op->region->h = resize_op->nh;
            }
            break;
            case UFSMM_UNDO_MOVE_VERTICE:
            {
                struct ufsmm_undo_move_vertice *move_op =
                        (struct ufsmm_undo_move_vertice *) op->data;
                move_op->vertice->x = move_op->nx;
                move_op->vertice->y = move_op->ny;
            }
            break;
            case UFSMM_UNDO_MOVE_COORDS:
            {
                struct ufsmm_undo_move_coords *move_op =
                        (struct ufsmm_undo_move_coords *) op->data;
                move_op->coords->x = move_op->nx;
                move_op->coords->y = move_op->ny;
                move_op->coords->w = move_op->nw;
                move_op->coords->h = move_op->nh;
            }
            break;
            case UFSMM_UNDO_MOVE_TRANSITION:
            {
                struct ufsmm_undo_move_transition *move_op =
                        (struct ufsmm_undo_move_transition *) op->data;

                if (move_op->is_source) {
                    if (move_op->transition->source.state != move_op->new_ref.state) {
                        TAILQ_REMOVE(&move_op->new_ref.state->transitions,
                                     move_op->transition, tailq);
                        TAILQ_INSERT_TAIL(&move_op->old_ref.state->transitions,
                                            move_op->transition, tailq);
                        move_op->transition->source.state = move_op->old_ref.state;
                    }
                    move_op->transition->source.offset = move_op->new_ref.offset;
                    move_op->transition->source.side = move_op->new_ref.side;
                } else {
                    move_op->transition->dest.state = move_op->new_ref.state;
                    move_op->transition->dest.offset = move_op->new_ref.offset;
                    move_op->transition->dest.side = move_op->new_ref.side;
                }
            }
            break;
            case UFSMM_UNDO_ADD_STATE:
            {
                struct ufsmm_undo_add_state *add_op =
                        (struct ufsmm_undo_add_state *) op->data;

                TAILQ_INSERT_TAIL(&add_op->state->parent_region->states,
                             add_op->state, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_REGION:
            {
                struct ufsmm_undo_add_region *add_op =
                        (struct ufsmm_undo_add_region *) op->data;

                TAILQ_INSERT_TAIL(&add_op->region->parent_state->regions,
                             add_op->region, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_TRANSITION:
            {
                struct ufsmm_undo_add_transition *add_op =
                        (struct ufsmm_undo_add_transition *) op->data;

                TAILQ_INSERT_TAIL(&add_op->transition->source.state->transitions,
                             add_op->transition, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_GUARD:
            {
                struct ufsmm_undo_add_guard *add_op =
                        (struct ufsmm_undo_add_guard *) op->data;

                TAILQ_INSERT_TAIL(&add_op->transition->guards,
                             add_op->guard, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_AREF:
            {
                struct ufsmm_undo_add_aref *add_op =
                        (struct ufsmm_undo_add_aref *) op->data;

                TAILQ_INSERT_TAIL(add_op->list,
                                 add_op->aref, tailq);
            }
            break;
            case UFSMM_UNDO_ADD_VERTICE:
            {
                struct ufsmm_undo_add_vertice *add_op =
                        (struct ufsmm_undo_add_vertice *) op->data;

                if (add_op->prev) {
                    TAILQ_INSERT_AFTER(&add_op->transition->vertices,
                                       add_op->prev,
                                       add_op->vertice, tailq);
                } else if (add_op->next) {
                    TAILQ_INSERT_BEFORE(add_op->next,
                                       add_op->vertice, tailq);
                } else {
                    TAILQ_INSERT_TAIL(&add_op->transition->vertices,
                                      add_op->vertice, tailq);
                }
            }
            break;
            case UFSMM_UNDO_REORDER_GUARD:
            {
                struct ufsmm_undo_reorder_guard *reorder_op =
                        (struct ufsmm_undo_reorder_guard *) op->data;
                if (reorder_op->nprev != NULL) {
                    TAILQ_REMOVE(&reorder_op->transition->guards,
                                 reorder_op->guard, tailq);
                    TAILQ_INSERT_AFTER(&reorder_op->transition->guards,
                                       reorder_op->nprev,
                                       reorder_op->guard, tailq);
                } else if (reorder_op->nnext != NULL) {
                    TAILQ_REMOVE(&reorder_op->transition->guards,
                                 reorder_op->guard, tailq);
                    TAILQ_INSERT_BEFORE(reorder_op->nnext,
                                       reorder_op->guard, tailq);
                }
            }
            break;
            case UFSMM_UNDO_REORDER_AREF:
            {
                struct ufsmm_undo_reorder_aref *reorder_op =
                        (struct ufsmm_undo_reorder_aref *) op->data;
                if (reorder_op->nprev != NULL) {
                    TAILQ_REMOVE(reorder_op->list,
                                 reorder_op->aref, tailq);
                    TAILQ_INSERT_AFTER(reorder_op->list,
                                       reorder_op->nprev,
                                       reorder_op->aref, tailq);
                } else if (reorder_op->nnext != NULL) {
                    TAILQ_REMOVE(reorder_op->list,
                                 reorder_op->aref, tailq);
                    TAILQ_INSERT_BEFORE(reorder_op->nnext,
                                       reorder_op->aref, tailq);
                }
            }
            break;
            case UFSMM_UNDO_DELETE_GUARD:
            {
                struct ufsmm_undo_delete_guard *delete_op =
                        (struct ufsmm_undo_delete_guard *) op->data;
                TAILQ_REMOVE(&delete_op->transition->guards,
                             delete_op->guard, tailq);
            }
            break;
            case UFSMM_UNDO_DELETE_AREF:
            {
                struct ufsmm_undo_delete_aref *delete_op =
                        (struct ufsmm_undo_delete_aref *) op->data;
                TAILQ_REMOVE(delete_op->list,
                             delete_op->aref, tailq);
            }
            break;
            case UFSMM_UNDO_DELETE_TRANSITION:
            {
                struct ufsmm_undo_delete_transition *delete_op = \
                     (struct ufsmm_undo_delete_transition *) op->data;
                TAILQ_REMOVE(&delete_op->transition->source.state->transitions,
                                  delete_op->transition, tailq);

            }
            break;
            case UFSMM_UNDO_DELETE_STATE:
            {
                struct ufsmm_undo_delete_state *delete_op = \
                     (struct ufsmm_undo_delete_state *) op->data;
                TAILQ_REMOVE(&delete_op->state->parent_region->states,
                                  delete_op->state, tailq);

            }
            break;
            case UFSMM_UNDO_DELETE_REGION:
            {
                struct ufsmm_undo_delete_region *delete_op = \
                     (struct ufsmm_undo_delete_region *) op->data;

                if (delete_op->region->parent_state) {
                    struct ufsmm_state *state = delete_op->region->parent_state;
                    TAILQ_REMOVE(&state->regions,
                                  delete_op->region, tailq);
                }

            }
            break;
            case UFSMM_UNDO_SET_TRIGGER:
            {
                struct ufsmm_undo_set_trigger *set_op = \
                    (struct ufsmm_undo_set_trigger *) op->data;

                set_op->transition->trigger = set_op->new_trigger;
                set_op->transition->trigger_kind = set_op->new_kind;
            }
            break;
            case UFSMM_UNDO_TOGGLE_OFF_PAGE:
            {
                struct ufsmm_undo_toggle_off_page *set_op = \
                    (struct ufsmm_undo_toggle_off_page *) op->data;

                set_op->region->off_page = set_op->new_value;
            }
            break;
        }
    }

    return 0;
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
    uc_rstatus_set(true);

    TAILQ_INSERT_TAIL(&undo->undo_stack, new, tailq);

    /* Clear redo stack */
    struct ufsmm_undo_ops_ref *item;
    while ((item = TAILQ_FIRST(&undo->redo_stack))) {
        TAILQ_REMOVE(&undo->redo_stack, item, tailq);
        ufsmm_undo_free_ops(undo, item->ops, false);
        free(item);
    }
    return 0;
}

int ufsmm_undo_free_ops(struct ufsmm_undo_context *undo,
                        struct ufsmm_undo_ops *ops,
                        bool purge)
{
    struct ufsmm_undo_op *item;

    while ((item = TAILQ_FIRST(ops))) {
        TAILQ_REMOVE(ops, item, tailq);
        if (item->kind == UFSMM_UNDO_RENAME_STATE) {
            struct ufsmm_undo_rename_state *rename_op = \
                   (struct ufsmm_undo_rename_state *) item->data;
            free((void *) rename_op->new_name);
            free((void *) rename_op->old_name);
        } else if (item->kind == UFSMM_UNDO_DELETE_GUARD) {
            struct ufsmm_undo_delete_guard *delete_op = \
                   (struct ufsmm_undo_delete_guard *) item->data;
            if (purge) {
                free(delete_op->guard);
            }
        } else if (item->kind == UFSMM_UNDO_DELETE_AREF) {
            struct ufsmm_undo_delete_aref *delete_op = \
                   (struct ufsmm_undo_delete_aref *) item->data;
            if (purge) {
                free(delete_op->aref);
            }
        } else if (item->kind == UFSMM_UNDO_DELETE_TRANSITION) {
            struct ufsmm_undo_delete_transition *delete_op = \
                   (struct ufsmm_undo_delete_transition *) item->data;
            /* TODO: If this is in the redo stack and the redo stack is
             *  flushed because new things are added to the undo
             *  stack, it will remove/unallocate stuff in the model
             *  that should not be removed/unallocated.
             *  It's not a problem with the 'delete' actions because
             *  those objects will be unallocated when the model
             *  is free'd.
             *
             *  But: The unallocation must be done when freeing the
             *  undo stack.
             **/
            if (purge) {
                ufsmm_state_delete_transition(delete_op->transition);
            }
        } else if (item->kind == UFSMM_UNDO_DELETE_STATE) {
            struct ufsmm_undo_delete_state *delete_op = \
                   (struct ufsmm_undo_delete_state *) item->data;
            if (purge) {
                ufsmm_model_delete_state(undo->model, delete_op->state);
            }
        } else if (item->kind == UFSMM_UNDO_DELETE_REGION) {
            struct ufsmm_undo_delete_region *delete_op = \
                   (struct ufsmm_undo_delete_region *) item->data;
            if (purge) {
                ufsmm_model_delete_region(undo->model, delete_op->region);
            }
        }
        free(item->data);
        free(item);
    }

    free(ops);
    return 0;
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

int ufsmm_undo_rename_region(struct ufsmm_undo_ops *ops,
                            struct ufsmm_region *region,
                            const char *old_name)
{
    int rc = 0;
    struct ufsmm_undo_rename_region *data = \
                       malloc(sizeof(struct ufsmm_undo_rename_region));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = malloc(sizeof(struct ufsmm_undo_op));

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    memset(op, 0, sizeof(*op));

    data->region = region;
    data->new_name = strdup(region->name);
    data->old_name = strdup(old_name);
    op->data = data;
    op->kind = UFSMM_UNDO_RENAME_REGION;

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

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->state = state;
    data->nx = state->x;
    data->ny = state->y;
    data->nw = state->w;
    data->nh = state->h;
    data->norientation = state->orientation;
    data->nparent_region = state->parent_region;
    data->ox = state->tx;
    data->oy = state->ty;
    data->ow = state->tw;
    data->oh = state->th;
    data->oorientation = state->torientation;
    data->oparent_region = state->tparent_region;
    op->data = data;
    op->kind = UFSMM_UNDO_RESIZE_STATE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_resize_region(struct ufsmm_undo_ops *ops,
                            struct ufsmm_region *region)
{
    int rc = 0;
    struct ufsmm_undo_resize_region *data = \
                       malloc(sizeof(struct ufsmm_undo_resize_region));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->region = region;
    data->nh = region->h;
    data->oh = region->th;
    op->data = data;
    op->kind = UFSMM_UNDO_RESIZE_REGION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_move_vertice(struct ufsmm_undo_ops *ops,
                            struct ufsmm_vertice *v)
{
    int rc = 0;
    struct ufsmm_undo_move_vertice *data = \
                       malloc(sizeof(struct ufsmm_undo_move_vertice));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->vertice = v;
    data->nx = v->x;
    data->ny = v->y;
    data->ox = v->tx;
    data->oy = v->ty;
    op->data = data;
    op->kind = UFSMM_UNDO_MOVE_VERTICE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_move_coords(struct ufsmm_undo_ops *ops,
                            struct ufsmm_coords *coords)
{
    int rc = 0;
    struct ufsmm_undo_move_coords *data = \
                       malloc(sizeof(struct ufsmm_undo_move_coords));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->coords = coords;
    data->nx = coords->x;
    data->ny = coords->y;
    data->nw = coords->w;
    data->nh = coords->h;
    data->ox = coords->tx;
    data->oy = coords->ty;
    data->ow = coords->tw;
    data->oh = coords->th;
    op->data = data;
    op->kind = UFSMM_UNDO_MOVE_COORDS;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

static int undo_move_transition(struct ufsmm_undo_ops *ops,
                                struct ufsmm_transition *transition,
                                struct ufsmm_transition_state_ref *old_ref,
                                bool is_source)
{
    int rc = 0;
    struct ufsmm_undo_move_transition *data = \
                       malloc(sizeof(struct ufsmm_undo_move_transition));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->is_source = is_source;

    if (is_source) {
        data->old_ref.state = old_ref->state;
        data->old_ref.offset = old_ref->offset;
        data->old_ref.side = old_ref->side;
        data->new_ref.state = transition->source.state;
        data->new_ref.offset = transition->source.offset;
        data->new_ref.side = transition->source.side;
    } else {
        data->old_ref.state = old_ref->state;
        data->old_ref.offset = old_ref->offset;
        data->old_ref.side = old_ref->side;
        data->new_ref.state = transition->dest.state;
        data->new_ref.offset = transition->dest.offset;
        data->new_ref.side = transition->dest.side;
    }

    op->data = data;
    op->kind = UFSMM_UNDO_MOVE_TRANSITION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_move_transition_source(struct ufsmm_undo_ops *ops,
                                     struct ufsmm_transition *transition,
                                     struct ufsmm_transition_state_ref *old_ref)
{
    return undo_move_transition(ops, transition, old_ref, true);
}

int ufsmm_undo_move_transition_dest(struct ufsmm_undo_ops *ops,
                                     struct ufsmm_transition *transition,
                                     struct ufsmm_transition_state_ref *old_ref)
{
    return undo_move_transition(ops, transition, old_ref, false);
}

int ufsmm_undo_add_state(struct ufsmm_undo_ops *ops,
                         struct ufsmm_state *state)
{
    int rc = 0;
    struct ufsmm_undo_add_state *data = \
                       malloc(sizeof(struct ufsmm_undo_add_state));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->state = state;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_STATE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_add_region(struct ufsmm_undo_ops *ops,
                         struct ufsmm_region *region)
{
    int rc = 0;
    struct ufsmm_undo_add_region *data = \
                       malloc(sizeof(struct ufsmm_undo_add_region));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->region = region;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_REGION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_add_transition(struct ufsmm_undo_ops *ops,
                                 struct ufsmm_transition *transition)
{
    int rc = 0;
    struct ufsmm_undo_add_transition *data = \
                       malloc(sizeof(struct ufsmm_undo_add_transition));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_TRANSITION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_add_guard(struct ufsmm_undo_ops *ops,
                         struct ufsmm_transition *transition,
                         struct ufsmm_guard_ref *gref)
{
    int rc = 0;
    struct ufsmm_undo_add_guard *data = \
                       malloc(sizeof(struct ufsmm_undo_add_guard));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->guard = gref;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_GUARD;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_reorder_guard(struct ufsmm_undo_ops *ops,
                             struct ufsmm_transition *transition,
                             struct ufsmm_guard_ref *guard,
                             struct ufsmm_guard_ref *old_prev,
                             struct ufsmm_guard_ref *old_next)
{
    int rc = 0;
    struct ufsmm_undo_reorder_guard *data = \
                       malloc(sizeof(struct ufsmm_undo_reorder_guard));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->guard = guard;
    data->oprev = old_prev;
    data->onext = old_next;
    data->nprev = TAILQ_PREV(guard, ufsmm_guard_refs, tailq);
    data->nnext = TAILQ_NEXT(guard, tailq);

    op->data = data;
    op->kind = UFSMM_UNDO_REORDER_GUARD;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_add_aref(struct ufsmm_undo_ops *ops,
                         struct ufsmm_action_refs *list,
                         struct ufsmm_action_ref *aref)
{
    int rc = 0;
    struct ufsmm_undo_add_aref *data = \
                       malloc(sizeof(struct ufsmm_undo_add_aref));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->list = list;
    data->aref = aref;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_AREF;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_add_vertice(struct ufsmm_undo_ops *ops,
                         struct ufsmm_transition *transition,
                         struct ufsmm_vertice *vertice,
                         struct ufsmm_vertice *prev,
                         struct ufsmm_vertice *next)
{
    int rc = 0;
    struct ufsmm_undo_add_vertice *data = \
                       malloc(sizeof(struct ufsmm_undo_add_vertice));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->vertice = vertice;
    data->prev = prev;
    data->next = next;
    op->data = data;
    op->kind = UFSMM_UNDO_ADD_VERTICE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_reorder_aref(struct ufsmm_undo_ops *ops,
                             struct ufsmm_action_refs *list,
                             struct ufsmm_action_ref *aref,
                             struct ufsmm_action_ref *old_prev,
                             struct ufsmm_action_ref *old_next)
{
    int rc = 0;
    struct ufsmm_undo_reorder_aref *data = \
                       malloc(sizeof(struct ufsmm_undo_reorder_aref));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->list = list;
    data->aref = aref;
    data->oprev = old_prev;
    data->onext = old_next;
    data->nprev = TAILQ_PREV(aref, ufsmm_action_refs, tailq);
    data->nnext = TAILQ_NEXT(aref, tailq);

    op->data = data;
    op->kind = UFSMM_UNDO_REORDER_AREF;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_delete_guard(struct ufsmm_undo_ops *ops,
                             struct ufsmm_transition *transition,
                             struct ufsmm_guard_ref *guard)
{
    int rc = 0;
    struct ufsmm_undo_delete_guard *data = \
                       malloc(sizeof(struct ufsmm_undo_delete_guard));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->guard = guard;
    data->prev = TAILQ_PREV(guard, ufsmm_guard_refs, tailq);
    data->next = TAILQ_NEXT(guard, tailq);

    op->data = data;
    op->kind = UFSMM_UNDO_DELETE_GUARD;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_delete_aref(struct ufsmm_undo_ops *ops,
                             struct ufsmm_action_refs *list,
                             struct ufsmm_action_ref *action)
{
    int rc = 0;
    struct ufsmm_undo_delete_aref *data = \
                       malloc(sizeof(struct ufsmm_undo_delete_aref));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->list = list;
    data->aref = action;
    data->prev = TAILQ_PREV(action, ufsmm_action_refs, tailq);
    data->next = TAILQ_NEXT(action, tailq);

    op->data = data;
    op->kind = UFSMM_UNDO_DELETE_AREF;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_delete_transition(struct ufsmm_undo_ops *ops,
                                 struct ufsmm_transition *transition)
{
    int rc = 0;
    struct ufsmm_undo_delete_transition *data = \
                       malloc(sizeof(struct ufsmm_undo_delete_transition));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    op->data = data;
    op->kind = UFSMM_UNDO_DELETE_TRANSITION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_delete_state(struct ufsmm_undo_ops *ops,
                            struct ufsmm_state *state)
{
    int rc = 0;
    struct ufsmm_undo_delete_state *data = \
                       malloc(sizeof(struct ufsmm_undo_delete_state));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->state = state;
    op->data = data;
    op->kind = UFSMM_UNDO_DELETE_STATE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_delete_region(struct ufsmm_undo_ops *ops,
                             struct ufsmm_region *region)
{
    int rc = 0;
    struct ufsmm_undo_delete_region *data = \
                       malloc(sizeof(struct ufsmm_undo_delete_region));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->region = region;
    op->data = data;
    op->kind = UFSMM_UNDO_DELETE_REGION;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_set_trigger(struct ufsmm_undo_ops *ops,
                           struct ufsmm_transition *transition,
                           struct ufsmm_trigger *old_trigger,
                           enum ufsmm_trigger_kind old_kind)
{
    int rc = 0;
    struct ufsmm_undo_set_trigger *data = \
                       malloc(sizeof(struct ufsmm_undo_set_trigger));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->transition = transition;
    data->old_trigger = old_trigger;
    data->old_kind = old_kind;
    data->new_trigger = transition->trigger;
    op->data = data;
    op->kind = UFSMM_UNDO_SET_TRIGGER;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}

int ufsmm_undo_toggle_offpage(struct ufsmm_undo_ops *ops,
                              struct ufsmm_region *region,
                              bool new_value)
{
    int rc = 0;
    struct ufsmm_undo_toggle_off_page *data = \
                       malloc(sizeof(struct ufsmm_undo_toggle_off_page));

    if (data == NULL)
        return -1;

    memset(data, 0, sizeof(*data));

    struct ufsmm_undo_op *op = new_undo_op();

    if (op == NULL) {
        rc = -1;
        goto err_free_data;
    }

    data->region = region;
    data->new_value = new_value;
    data->old_value = new_value?false:true;
    op->data = data;
    op->kind = UFSMM_UNDO_TOGGLE_OFF_PAGE;

    TAILQ_INSERT_TAIL(ops, op, tailq);

    return rc;
err_free_data:
    free(data);
    return rc;
}
