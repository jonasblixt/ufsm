#include <string.h>
#include <ufsm/model.h>

struct ufsmm_ll_node* ufsmm_ll_init_node(void *data)
{
    struct ufsmm_ll_node *new_node = malloc(sizeof(struct ufsmm_ll_node));

    if (new_node == NULL)
        return NULL;
    memset(new_node, 0, sizeof(*new_node));
    new_node->data = data;
    return new_node;
}

void ufsmm_ll_free_node(struct ufsmm_ll_node *node)
{
    memset(node, 0, sizeof(*node));
    free(node);
}

int ufsmm_ll_init(struct ufsmm_ll **ll)
{
    struct ufsmm_ll *new_ll = malloc(sizeof(struct ufsmm_ll));

    if (new_ll == NULL) {
        return -1;
    }

    memset(new_ll, 0, sizeof(*new_ll));
    *ll = new_ll;
    return 0;
}

int ufsmm_ll_free(struct ufsmm_ll *ll)
{
    free(ll);
    return 0;
}

int ufsmm_ll_append(struct ufsmm_ll *ll, struct ufsmm_ll_node *node)
{
    if (ll->last != NULL) {
        node->prev = ll->last;
        ll->last->next = node;
    }

    ll->last = node;

    if (ll->first == NULL) {
        ll->first = node;
    }
    return 0;
}

int ufsmm_ll_append2(struct ufsmm_ll *ll, void *data)
{
    struct ufsmm_ll_node *new_node = NULL;

    if (ufsmm_ll_init_node(&new_node) != UFSMM_OK)
        return -1;

    new_node->data = data;

    return ufsmm_ll_append(ll, new_node);
}

int ufsmm_ll_prepend(struct ufsmm_ll *ll, struct ufsmm_ll_node *node)
{
    if (ll->first != NULL) {
        node->next = ll->first;
        ll->first->prev = node;
    }
    ll->first = node;

    return 0;
}

int ufsmm_ll_pop(struct ufsmm_ll *ll, struct ufsmm_ll_node **node)
{
    if (ll->last == NULL) {
        *node = NULL;
        return -1;
    }

    struct ufsmm_ll_node *new_last = ll->last->prev;

    *node = ll->last;

    if (new_last != NULL) {
        new_last->next = NULL;
        ll->last = new_last;
    } else {
        ll->last = NULL;
        ll->first = NULL;
    }

    return 0;
}

int ufsmm_ll_pop2(struct ufsmm_ll *ll, void **data)
{
    struct ufsmm_ll_node *node = NULL;

    if (ufsmm_ll_pop(ll, &node) == UFSMM_OK) {
        *data = node->data;
        free(node);
        return 0;
    } else {
        return -1;
    }
}

int ufsmm_ll_find(struct ufsmm_ll *ll, void *data_ref,
                                    struct ufsmm_ll_node **node)
{

    for (struct ufsmm_ll_node *n = ll->first; n; n = n->next) {
        if (n->data == data_ref) {
            *node = n;
            return 0;
        }
    }
    return -1;
}

int ufsmm_ll_get_first(struct ufsmm_ll *ll, struct ufsmm_ll_node **node)
{
    *node = ll->first;
    return 0;
}

int ufsmm_ll_get_last(struct ufsmm_ll *ll, struct ufsmm_ll_node **node)
{
    *node = ll->last;
    return 0;
}

int ufsmm_ll_move_up(struct ufsmm_ll *ll, struct ufsmm_ll_node *node)
{
    struct ufsmm_ll_node *prev = node->prev;
    struct ufsmm_ll_node *next = node->next;

    if (prev == NULL)
        return 0;

    /* First in the list? */
    if (prev->prev == NULL) {
        prev->next = node->next;
        prev->prev = node;
        if (next != NULL) {
            next->prev = prev;
        } else {
            ll->last = node->prev;
        }
        node->next = prev;
        node->prev = NULL;
        ll->first = node;
    } else {
        prev->prev->next = node;
        /* Was this the last node? */
        if (next != NULL) {
            next->prev = node;
        } else {
            ll->last = prev;
            ll->last->next = NULL;
        }
        node->next = prev;
        node->prev = prev->prev;
        prev->prev = node;
    }

    return 0;
}

int ufsmm_ll_move_down(struct ufsmm_ll *ll, struct ufsmm_ll_node *node)
{
    struct ufsmm_ll_node *prev = node->prev;
    struct ufsmm_ll_node *next = node->next;

    /* Already at the end? */
    if (next == NULL)
        return 0;

    /* About to become last in the list */
    if (next->next == NULL) {
        next->next = node;
        next->prev = prev;
        if (prev != NULL) {
            prev->next = next;
        } else {
            ll->first = node->next;
        }
        node->next = NULL;
        node->prev = next;
        ll->last = node;
    } else {
        next->next->prev = node;
        /* Was this the first node? */
        if (prev != NULL) {
            prev->next = node;
        } else {
            ll->first = next;
            ll->first->prev = NULL;
        }
        node->next = next->next;
        node->prev = next;
        next->next = node;
    }

    return 0;
}

int ufsmm_ll_remove(struct ufsmm_ll *ll, struct ufsmm_ll_node *node)
{
    struct ufsmm_ll_node *prev = node->prev;
    struct ufsmm_ll_node *next = node->next;

    /* node is at the end of the list */
    if (next == NULL) {
        /* Last node in list?*/
        if (prev) {
            prev->next = NULL;
        } else {
            ll->first = NULL;
        }
        ll->last = prev;
    } else if (prev == NULL) {
        /* First node */
        ll->first = node->next;
        if (ll->first) {
            ll->first->prev = NULL;
        }
    } else {
        prev->next = next;
        next->prev = prev;
    }

    free(node);
    return 0;
}

int ufsmm_ll_insert_before(struct ufsmm_ll *ll,
                           struct ufsmm_ll_node *before_node,
                           struct ufsmm_ll_node *node)
{
    if (before_node->prev == NULL) {
        /* Was this the first node? */
        node->prev = NULL;
        node->next = before_node;
        ll->first = node;
        before_node->prev = node;
    } else {
        node->next = before_node;
        node->prev = before_node->prev;
        before_node->prev->next = node;
        before_node->prev = node;
    }

    return 0;
}

int ufsmm_ll_insert_after(struct ufsmm_ll *ll,
                           struct ufsmm_ll_node *after_node,
                           struct ufsmm_ll_node *node)
{
    if (after_node->next == NULL) {
        /* Was this the last node? */
        node->next = NULL;
        node->prev = after_node;
        ll->last = node;
        after_node->next = node;
    } else {
        node->next = after_node->next;
        node->prev = after_node;
        after_node->next->prev = node;
        after_node->next = node;
    }

    return 0;
}
