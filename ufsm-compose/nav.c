#include <stdlib.h>
#include <string.h>
#include <math.h>
#include <ufsm/ufsm.h>
#include <gtk/gtk.h>
#include "nav.h"
#include "controller.h"
#include "render.h"
#include "utils.h"
#include "logic/canvas.h"

enum {
    SC_COL_TEXT,
    SC_COL_OBJ,
    SC_NUM_COLS
};

static GtkTreeStore *sc_store;

static int stack_push_r_iter_pair(struct ufsmm_stack *stack,
                                  struct ufsmm_region *r,
                                  GtkTreeIter *iter)
{
    int rc;

    rc = ufsmm_stack_push(stack, r);

    if (rc != UFSMM_OK)
        return rc;

    return ufsmm_stack_push(stack, iter);
}

static int stack_pop_r_iter_pair(struct ufsmm_stack *stack,
                                 struct ufsmm_region **r,
                                 GtkTreeIter **iter)
{
    int rc;

    rc = ufsmm_stack_pop(stack, (void **) iter);

    if (rc != UFSMM_OK)
        return rc;

    return ufsmm_stack_pop(stack, (void **) r);
}
static int update_sc_tree(struct ufsmm_model *model,
                          GtkTreeStore *store)
{
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    static struct ufsmm_stack *stack;
    struct ufsmm_stack *cleanup_stack;
    int rc;
    GtkTreeIter *s_iter = NULL;
    GtkTreeIter *r_iter = NULL;
    GtkTreeIter *parent = NULL;

    rc = ufsmm_stack_init(&cleanup_stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return rc;

    rc = ufsmm_stack_init(&stack, UFSMM_MAX_R_S);

    if (rc != UFSMM_OK)
        return rc;

    rc = stack_push_r_iter_pair(stack, model->root, NULL);

    while (stack_pop_r_iter_pair(stack, &r, &parent) == UFSMM_OK)
    {
        r_iter = malloc(sizeof(*s_iter));
        ufsmm_stack_push(cleanup_stack, (void *) r_iter);

        gtk_tree_store_append(store, r_iter, parent);
        gtk_tree_store_set (store, r_iter,
                            SC_COL_TEXT, r->name,
                            SC_COL_OBJ, r,
                            -1);

        TAILQ_FOREACH(s, &r->states, tailq) {
            s_iter = malloc(sizeof(*s_iter));
            ufsmm_stack_push(cleanup_stack, (void *) s_iter);

            gtk_tree_store_append(store, s_iter, r_iter);
            gtk_tree_store_set (store, s_iter,
                                SC_COL_TEXT, s->name,
                                SC_COL_OBJ, s,
                                -1);
            TAILQ_FOREACH(r2, &s->regions, tailq) {
                stack_push_r_iter_pair(stack, r2, s_iter);
            }
        }
    }

    /* Free temprary iterators */
    void *p;

    while(ufsmm_stack_pop(cleanup_stack, &p) == UFSMM_OK) {
        free(p);
    }

    ufsmm_stack_free(cleanup_stack);
    ufsmm_stack_free(stack);

    return UFSMM_OK;
}

GtkWidget* ufsmm_nav_init(void)
{
    GtkWidget *sc_scrolled_window = gtk_scrolled_window_new(NULL, NULL);
    GtkTreeViewColumn *sc_col;
    GtkCellRenderer *sc_renderer;

    sc_store = gtk_tree_store_new(SC_NUM_COLS,
                                             G_TYPE_STRING,
                                             G_TYPE_POINTER);
    GtkWidget *tree = gtk_tree_view_new_with_model(GTK_TREE_MODEL(sc_store));

    gtk_tree_view_set_show_expanders(GTK_TREE_VIEW(tree), TRUE);
    gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(tree), FALSE);
    gtk_tree_view_set_enable_tree_lines(GTK_TREE_VIEW(tree), TRUE);
    gtk_tree_view_set_enable_search(GTK_TREE_VIEW(tree), FALSE);

    sc_col = gtk_tree_view_column_new();
    gtk_tree_view_column_set_title(sc_col, "Title");

    sc_renderer = gtk_cell_renderer_text_new();
    gtk_tree_view_column_pack_start(sc_col, sc_renderer, TRUE);
    gtk_tree_view_column_set_attributes(sc_col, sc_renderer,
                                        "text", SC_COL_TEXT,
                                        NULL);

    gtk_tree_view_append_column(GTK_TREE_VIEW(tree), sc_col);

    gtk_container_add(GTK_CONTAINER(sc_scrolled_window), tree);

    return sc_scrolled_window;
}

int ufsmm_nav_update(struct ufsmm_model *model)
{
    return update_sc_tree(model, sc_store);
}
