#include "project_settings.h"

enum {
  ACT_COLUMN_NAME,
  ACT_COLUMN_USAGE,
  ACT_COLUMN_DEL,
  ACT_COLUMN_ACTION_REF,
  ACT_COLUMN_LIST_REF,
  ACT_NUM_COLUMNS
};

static void fixed_toggled(GtkCellRendererToggle *cell, gchar *path_str,
                            gpointer data)
{
  GtkTreeModel *model = (GtkTreeModel *)data;
  GtkTreeIter  iter;
  GtkTreePath *path = gtk_tree_path_new_from_string(path_str);
  gboolean fixed;

  /* get toggled iter */
  gtk_tree_model_get_iter(model, &iter, path);
  gtk_tree_model_get(model, &iter, ACT_COLUMN_DEL, &fixed, -1);

  /* do something with the value */
  fixed ^= 1;

  /* set new value */
  gtk_list_store_set(GTK_LIST_STORE(model), &iter, ACT_COLUMN_DEL, fixed, -1);

  /* clean up */
  gtk_tree_path_free(path);
}

static void cell_edited(GtkCellRendererText *cell, const gchar *path_string,
                            const gchar *new_text, gpointer data)
{
    GtkTreeModel *model = (GtkTreeModel *)data;
    GtkTreePath *path = gtk_tree_path_new_from_string(path_string);
    GtkTreeIter iter;


    gtk_tree_model_get_iter(model, &iter, path);

    gint i;
    gchar *old_text;

    gtk_tree_model_get(model, &iter, ACT_COLUMN_NAME, &old_text, -1);
    g_free(old_text);

    gtk_list_store_set(GTK_LIST_STORE(model), &iter, ACT_COLUMN_NAME,
                    strdup(new_text), -1);

    gtk_tree_path_free(path);
}

GtkListStore *create_trigger_tab(GtkNotebook *notebook, struct ufsmm_model *model)
{
    GtkWidget *lbl = gtk_label_new("Triggers");
    GtkWidget *scrolled_window = gtk_scrolled_window_new(NULL, NULL);
    gtk_widget_set_margin_bottom(scrolled_window, 10);

    /* Create treeview */
    GtkTreeIter iter;
    GtkListStore *store = gtk_list_store_new (ACT_NUM_COLUMNS,
                                                G_TYPE_STRING,
                                                G_TYPE_UINT,
                                                G_TYPE_BOOLEAN,
                                                G_TYPE_POINTER,
                                                G_TYPE_POINTER);

    struct ufsmm_trigger *t;


    TAILQ_FOREACH(t, &model->triggers, tailq) {
        gtk_list_store_append(store, &iter);
        gtk_list_store_set (store, &iter,
                            ACT_COLUMN_NAME, t->name,
                            ACT_COLUMN_USAGE, t->usage_count,
                            ACT_COLUMN_DEL, false,
                            ACT_COLUMN_ACTION_REF, t,
                            ACT_COLUMN_LIST_REF, &model->triggers,
                            -1);
    }

    GtkWidget *treeview = gtk_tree_view_new_with_model(GTK_TREE_MODEL(store));
    gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(treeview), TRUE);
    gtk_tree_view_set_enable_search(GTK_TREE_VIEW(treeview), TRUE);

    GtkCellRenderer *renderer;
    GtkTreeViewColumn *column;

    /* Delete column */
    renderer = gtk_cell_renderer_toggle_new();
    g_signal_connect(renderer, "toggled", G_CALLBACK(fixed_toggled), store);
    column = gtk_tree_view_column_new_with_attributes("Del",
                                                       renderer,
                                                       "active", ACT_COLUMN_DEL,
                                                       NULL);

    /* set this column to a fixed sizing (of 50 pixels) */
    gtk_tree_view_column_set_sizing(GTK_TREE_VIEW_COLUMN(column),
                                   GTK_TREE_VIEW_COLUMN_FIXED);
    gtk_tree_view_column_set_fixed_width(GTK_TREE_VIEW_COLUMN(column), 70);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Name column */
    renderer = gtk_cell_renderer_text_new();
    g_object_set(renderer, "editable", TRUE, NULL);
    g_signal_connect(renderer, "edited", G_CALLBACK(cell_edited), store);
    column = gtk_tree_view_column_new_with_attributes("Name",
                                                       renderer,
                                                       "text", ACT_COLUMN_NAME,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_NAME);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Usage column */
    renderer = gtk_cell_renderer_text_new();
    column = gtk_tree_view_column_new_with_attributes("Usage",
                                                       renderer,
                                                       "text", ACT_COLUMN_USAGE,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_USAGE);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);


    gtk_container_add(GTK_CONTAINER(scrolled_window), treeview);
    gtk_notebook_append_page(GTK_NOTEBOOK(notebook), scrolled_window, lbl);

    return store;
}


GtkListStore *create_guard_tab(GtkNotebook *notebook, struct ufsmm_model *model)
{
    GtkWidget *lbl = gtk_label_new("Guard functions");
    GtkWidget *scrolled_window = gtk_scrolled_window_new(NULL, NULL);
    gtk_widget_set_margin_bottom(scrolled_window, 10);

    /* Create treeview */
    GtkTreeIter iter;
    GtkListStore *store = gtk_list_store_new (ACT_NUM_COLUMNS,
                                                G_TYPE_STRING,
                                                G_TYPE_UINT,
                                                G_TYPE_BOOLEAN,
                                                G_TYPE_POINTER,
                                                G_TYPE_POINTER);

    struct ufsmm_action *a;


    TAILQ_FOREACH(a, &model->guards, tailq) {
        gtk_list_store_append(store, &iter);
        gtk_list_store_set (store, &iter,
                            ACT_COLUMN_NAME, a->name,
                            ACT_COLUMN_USAGE, a->usage_count,
                            ACT_COLUMN_DEL, false,
                            ACT_COLUMN_ACTION_REF, a,
                            ACT_COLUMN_LIST_REF, &model->guards,
                            -1);
    }

    GtkWidget *treeview = gtk_tree_view_new_with_model(GTK_TREE_MODEL(store));
    gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(treeview), TRUE);
    gtk_tree_view_set_enable_search(GTK_TREE_VIEW(treeview), TRUE);

    GtkCellRenderer *renderer;
    GtkTreeViewColumn *column;

    /* Delete column */
    renderer = gtk_cell_renderer_toggle_new();
    g_signal_connect(renderer, "toggled", G_CALLBACK(fixed_toggled), store);
    column = gtk_tree_view_column_new_with_attributes("Del",
                                                       renderer,
                                                       "active", ACT_COLUMN_DEL,
                                                       NULL);

    /* set this column to a fixed sizing (of 50 pixels) */
    gtk_tree_view_column_set_sizing(GTK_TREE_VIEW_COLUMN(column),
                                   GTK_TREE_VIEW_COLUMN_FIXED);
    gtk_tree_view_column_set_fixed_width(GTK_TREE_VIEW_COLUMN(column), 70);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Name column */
    renderer = gtk_cell_renderer_text_new();
    g_object_set(renderer, "editable", TRUE, NULL);
    g_signal_connect(renderer, "edited", G_CALLBACK(cell_edited), store);
    column = gtk_tree_view_column_new_with_attributes("Name",
                                                       renderer,
                                                       "text", ACT_COLUMN_NAME,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_NAME);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Usage column */
    renderer = gtk_cell_renderer_text_new();
    column = gtk_tree_view_column_new_with_attributes("Usage",
                                                       renderer,
                                                       "text", ACT_COLUMN_USAGE,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_USAGE);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);


    gtk_container_add(GTK_CONTAINER(scrolled_window), treeview);
    gtk_notebook_append_page(GTK_NOTEBOOK(notebook), scrolled_window, lbl);

    return store;
}

GtkListStore *create_action_tab(GtkNotebook *notebook, struct ufsmm_model *model)
{
    GtkWidget *lbl = gtk_label_new("Action functions");
    GtkWidget *scrolled_window = gtk_scrolled_window_new(NULL, NULL);
    gtk_widget_set_margin_bottom(scrolled_window, 10);

    /* Create treeview */
    GtkTreeIter iter;
    GtkListStore *store = gtk_list_store_new (ACT_NUM_COLUMNS,
                                                G_TYPE_STRING,
                                                G_TYPE_UINT,
                                                G_TYPE_BOOLEAN,
                                                G_TYPE_POINTER,
                                                G_TYPE_POINTER);

    struct ufsmm_action *a;

    TAILQ_FOREACH(a, &model->actions, tailq) {
        gtk_list_store_append(store, &iter);
        gtk_list_store_set (store, &iter,
                            ACT_COLUMN_NAME, a->name,
                            ACT_COLUMN_USAGE, a->usage_count,
                            ACT_COLUMN_DEL, false,
                            ACT_COLUMN_ACTION_REF, a,
                            ACT_COLUMN_LIST_REF, &model->actions,
                            -1);
    }

    GtkWidget *treeview = gtk_tree_view_new_with_model(GTK_TREE_MODEL(store));
    gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(treeview), TRUE);
    gtk_tree_view_set_enable_search(GTK_TREE_VIEW(treeview), TRUE);

    GtkCellRenderer *renderer;
    GtkTreeViewColumn *column;

    /* Delete column */
    renderer = gtk_cell_renderer_toggle_new();
    g_signal_connect(renderer, "toggled", G_CALLBACK(fixed_toggled), store);
    column = gtk_tree_view_column_new_with_attributes("Del",
                                                       renderer,
                                                       "active", ACT_COLUMN_DEL,
                                                       NULL);

    /* set this column to a fixed sizing (of 50 pixels) */
    gtk_tree_view_column_set_sizing(GTK_TREE_VIEW_COLUMN(column),
                                   GTK_TREE_VIEW_COLUMN_FIXED);
    gtk_tree_view_column_set_fixed_width(GTK_TREE_VIEW_COLUMN(column), 70);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Name column */
    renderer = gtk_cell_renderer_text_new();
    g_object_set(renderer, "editable", TRUE, NULL);
    g_signal_connect(renderer, "edited", G_CALLBACK(cell_edited), store);
    column = gtk_tree_view_column_new_with_attributes("Name",
                                                       renderer,
                                                       "text", ACT_COLUMN_NAME,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_NAME);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);

    /* Usage column */
    renderer = gtk_cell_renderer_text_new();
    column = gtk_tree_view_column_new_with_attributes("Usage",
                                                       renderer,
                                                       "text", ACT_COLUMN_USAGE,
                                                       NULL);

    gtk_tree_view_column_set_sort_column_id(column, ACT_COLUMN_USAGE);
    gtk_tree_view_append_column(GTK_TREE_VIEW(treeview), column);


    gtk_container_add(GTK_CONTAINER(scrolled_window), treeview);
    gtk_notebook_append_page(GTK_NOTEBOOK(notebook), scrolled_window, lbl);

    return store;
}

static void name_input_changed(GtkEntry *entry, gpointer user_data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(entry));
    struct ufsmm_model *model = (struct ufsmm_model *) user_data;
    L_DEBUG("Name changed: %s", text);
    free((void *) model->name);
    model->name = strdup(text);
}

static void paper_sz_changed(GtkComboBox *cbx, gpointer user_data)
{
    int active = gtk_combo_box_get_active(GTK_COMBO_BOX(cbx));
    struct ufsmm_model *model = (struct ufsmm_model *) user_data;
    L_DEBUG("Paper sz changed: %i", active);
    model->paper_size = active;
}

void create_general_tab(GtkNotebook *notebook, struct ufsmm_model *model)
{
    GtkWidget *lbl = gtk_label_new("General");
    GtkWidget *vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_container_set_border_width(GTK_CONTAINER(vbox), 8);
    gtk_widget_set_halign(vbox, GTK_ALIGN_FILL);

    /* Project name input */
    GtkWidget *prj_name_lbl = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(prj_name_lbl), "<b>Project name</b>");
    gtk_widget_set_halign(prj_name_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), prj_name_lbl, FALSE, FALSE, 10);

    GtkWidget *prj_name_entry = gtk_entry_new();
    gtk_entry_set_text(GTK_ENTRY(prj_name_entry), model->name);
    gtk_widget_set_margin_start(prj_name_entry, 50);
    gtk_widget_set_margin_end(prj_name_entry, 50);
    gtk_box_pack_start(GTK_BOX(vbox), prj_name_entry, FALSE, FALSE, 10);
    g_signal_connect(G_OBJECT(prj_name_entry), "changed",
                                      G_CALLBACK(name_input_changed),
                                      model);

    /* Paper size */
    GtkWidget *paper_sz_lbl = gtk_label_new(NULL);
    gtk_label_set_markup(GTK_LABEL(paper_sz_lbl), "<b>Paper size</b>");
    gtk_widget_set_halign(paper_sz_lbl, GTK_ALIGN_START);
    gtk_box_pack_start(GTK_BOX(vbox), paper_sz_lbl, FALSE, FALSE, 10);


    GtkWidget *paper_sz_cbx = gtk_combo_box_text_new();
    gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(paper_sz_cbx), "A4");
    gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(paper_sz_cbx), "A3");
    gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(paper_sz_cbx), "A2");
    gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(paper_sz_cbx), "A1");
    gtk_combo_box_set_active(GTK_COMBO_BOX(paper_sz_cbx), model->paper_size);
    gtk_widget_set_margin_start(paper_sz_cbx, 50);
    gtk_widget_set_margin_end(paper_sz_cbx, 50);
    gtk_box_pack_start(GTK_BOX(vbox), paper_sz_cbx, FALSE, FALSE, 10);
    g_signal_connect(G_OBJECT(paper_sz_cbx), "changed",
                                      G_CALLBACK(paper_sz_changed),
                                      model);

    gtk_notebook_append_page(GTK_NOTEBOOK(notebook), vbox, lbl);
}

static void delete_gref(struct ufsmm_model *model,
                        struct ufsmm_actions *list, struct ufsmm_action *act)
{
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;
    struct ufsmm_guard_ref *gref, *gref2;

    /* First delete all references to this action */
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, model->root);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                for (gref = TAILQ_FIRST(&t->guards); gref != NULL; gref = gref2) {
                    gref2 = TAILQ_NEXT(gref, tailq);
                    if (gref->act == act) {
                        L_DEBUG("Deleting guard ref to %s on transition %s->%s",
                                gref->act->name, t->source.state->name, t->dest.state->name);
                        TAILQ_REMOVE(&t->guards, gref, tailq);
                        gref->act->usage_count--;
                        free(gref);
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }

        }
    }

    TAILQ_REMOVE(list, act, tailq);
    free((void *) act->name);
    free(act);
}

static void delete_aref(struct ufsmm_model *model,
                        struct ufsmm_actions *list, struct ufsmm_action *act)
{
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;
    struct ufsmm_action_ref *aref, *aref2;

    /* First delete all references to this action */
    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, model->root);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            for (aref = TAILQ_FIRST(&s->exits); aref != NULL; aref = aref2) {
                aref2 = TAILQ_NEXT(aref, tailq);
                if (aref->act == act) {
                    L_DEBUG("Deleting exit ref to %s on state %s", aref->act->name, s->name);
                    TAILQ_REMOVE(&s->exits, aref, tailq);
                    aref->act->usage_count--;
                    free(aref);
                }
            }
            for (aref = TAILQ_FIRST(&s->entries); aref != NULL; aref = aref2) {
                aref2 = TAILQ_NEXT(aref, tailq);
                if (aref->act == act) {
                    L_DEBUG("Deleting entry ref to %s on state %s", aref->act->name, s->name);
                    TAILQ_REMOVE(&s->entries, aref, tailq);
                    aref->act->usage_count--;
                    free(aref);
                }
            }

            TAILQ_FOREACH(t, &s->transitions, tailq) {
                for (aref = TAILQ_FIRST(&t->actions); aref != NULL; aref = aref2) {
                    aref2 = TAILQ_NEXT(aref, tailq);
                    if (aref->act == act) {
                        L_DEBUG("Deleting action ref to %s on transition %s->%s",
                                aref->act->name, t->source.state->name, t->dest.state->name);
                        TAILQ_REMOVE(&t->actions, aref, tailq);
                        aref->act->usage_count--;
                        free(aref);
                    }
                }
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }

        }
    }

    TAILQ_REMOVE(list, act, tailq);
    free((void *) act->name);
    free(act);
}

static void delete_trigger(struct ufsmm_model *model, struct ufsmm_trigger *trigger)
{
    struct ufsmm_stack *stack;
    struct ufsmm_region *r, *r2;
    struct ufsmm_state *s;
    struct ufsmm_transition *t;

    ufsmm_stack_init(&stack, UFSMM_MAX_R_S);
    ufsmm_stack_push(stack, model->root);

    while (ufsmm_stack_pop(stack, (void **) &r) == UFSMM_OK) {
        TAILQ_FOREACH(s, &r->states, tailq) {
            TAILQ_FOREACH(t, &s->transitions, tailq) {
                if (t->trigger == trigger)
                    t->trigger = NULL;
            }

            TAILQ_FOREACH(r2, &s->regions, tailq) {
                ufsmm_stack_push(stack, r2);
            }

        }
    }

    TAILQ_REMOVE(&model->triggers, trigger, tailq);
    free((void *) trigger->name);
    free(trigger);
}
int ufsm_project_settings_dialog(GtkWindow *parent, struct ufsmm_model *model)
{
    int rc;
    GtkWidget *dialog, *label, *content_area;
    GtkDialogFlags flags;
    struct ufsmm_model model_copy;

    memcpy(&model_copy, model, sizeof(*model));
    flags = GTK_DIALOG_MODAL;
    dialog = gtk_dialog_new_with_buttons("Project settings",
                                       parent,
                                       flags,
                                       "_OK",
                                       GTK_RESPONSE_ACCEPT,
                                       "_Cancel",
                                       GTK_RESPONSE_REJECT,
                                       NULL);

    gtk_widget_set_size_request(dialog, 800, 600);

    content_area = gtk_dialog_get_content_area(GTK_DIALOG(dialog));

    gtk_widget_set_margin_start(content_area, 10);
    gtk_widget_set_margin_end(content_area, 10);
    gtk_widget_set_margin_top(content_area, 10);
    gtk_widget_set_margin_bottom(content_area, 10);

    /* Tabs */
    GtkWidget *notebook = gtk_notebook_new();

    gtk_widget_set_margin_bottom(notebook, 10);
    gtk_notebook_set_tab_pos(GTK_NOTEBOOK(notebook), GTK_POS_TOP);
    gtk_notebook_set_show_tabs(GTK_NOTEBOOK(notebook), true);
    gtk_notebook_set_current_page(GTK_NOTEBOOK(notebook), 0);

    create_general_tab(GTK_NOTEBOOK(notebook), model);
    GtkListStore *action_list = create_action_tab(GTK_NOTEBOOK(notebook), model);
    GtkListStore *guard_list = create_guard_tab(GTK_NOTEBOOK(notebook), model);
    GtkListStore *trigger_list = create_trigger_tab(GTK_NOTEBOOK(notebook), model);

    gtk_box_pack_start(GTK_BOX(content_area), notebook, TRUE, TRUE, 0);
    gtk_widget_show_all(notebook);

    int result = gtk_dialog_run(GTK_DIALOG(dialog));

    if (result == GTK_RESPONSE_ACCEPT) {
        GtkTreeIter iter;
        gboolean delete_iter;
        gchar *act_name, *trigger_name;
        struct ufsmm_action *act;
        struct ufsmm_actions *act_list;
        struct ufsmm_trigger *trigger;

        if (gtk_tree_model_get_iter_first(GTK_TREE_MODEL(action_list), &iter)) {
            do {
                gtk_tree_model_get(GTK_TREE_MODEL(action_list), &iter,
                                    ACT_COLUMN_NAME, &act_name, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(action_list), &iter,
                                    ACT_COLUMN_DEL, &delete_iter, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(action_list), &iter,
                                    ACT_COLUMN_ACTION_REF, &act, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(action_list), &iter,
                                    ACT_COLUMN_LIST_REF, &act_list, -1);

                if (strcmp(act_name, act->name) != 0) {
                    L_DEBUG("%s changed name to %s", act->name, act_name);
                    free((void *) act->name);
                    act->name = act_name;
                }
                if (delete_iter) {
                    L_DEBUG("Want to delete '%s'", act->name);
                    delete_aref(model, act_list, act);
                }
            } while (gtk_tree_model_iter_next(GTK_TREE_MODEL(action_list), &iter));
        }

        if (gtk_tree_model_get_iter_first(GTK_TREE_MODEL(guard_list), &iter)) {
            do {
                gtk_tree_model_get(GTK_TREE_MODEL(guard_list), &iter,
                                    ACT_COLUMN_NAME, &act_name, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(guard_list), &iter,
                                    ACT_COLUMN_DEL, &delete_iter, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(guard_list), &iter,
                                    ACT_COLUMN_ACTION_REF, &act, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(guard_list), &iter,
                                    ACT_COLUMN_LIST_REF, &act_list, -1);

                if (strcmp(act_name, act->name) != 0) {
                    L_DEBUG("%s changed name to %s", act->name, act_name);
                    free((void *) act->name);
                    act->name = act_name;
                }
                if (delete_iter) {
                    L_DEBUG("Want to delete '%s'", act->name);
                    delete_gref(model, act_list, act);
                }
            } while (gtk_tree_model_iter_next(GTK_TREE_MODEL(guard_list), &iter));
        }

        if (gtk_tree_model_get_iter_first(GTK_TREE_MODEL(trigger_list), &iter)) {
            do {
                gtk_tree_model_get(GTK_TREE_MODEL(trigger_list), &iter,
                                    ACT_COLUMN_NAME, &trigger_name, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(trigger_list), &iter,
                                    ACT_COLUMN_DEL, &delete_iter, -1);
                gtk_tree_model_get(GTK_TREE_MODEL(trigger_list), &iter,
                                    ACT_COLUMN_ACTION_REF, &trigger, -1);

                if (strcmp(trigger_name, trigger->name) != 0) {
                    L_DEBUG("Trigger %s changed name to %s", trigger->name, trigger_name);
                    free((void *) trigger->name);
                    trigger->name = trigger_name;
                }
                if (delete_iter) {
                    L_DEBUG("Want to delete trigger '%s'", trigger->name);
                    delete_trigger(model, trigger);
                }
            } while (gtk_tree_model_iter_next(GTK_TREE_MODEL(trigger_list), &iter));
        }
        rc = 0;
    } else {
        memcpy(model, &model_copy, sizeof(*model));
        rc = -1;
    }

    gtk_widget_destroy (dialog);

    return rc;
}
