#include <gtk/gtk.h>
#include <ufsm/model.h>

enum
{
  COLUMN_MATCH_RATING,
  COLUMN_NAME,
  COLUMN_ACTION_REF,
  COLUMN_SIGNAL,
  NUM_COLUMNS
};

struct ufsmm_action *selected_action;
struct ufsmm_trigger *selected_signal;

static void input_changed(GtkEntry *entry, gpointer user_data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(entry));
    GtkTreeSelection *selection = \
                gtk_tree_view_get_selection(GTK_TREE_VIEW(user_data));

    L_DEBUG("Input changed: %s", text);

    GtkTreeModel *model = gtk_tree_view_get_model(GTK_TREE_VIEW(user_data));
    GtkTreeIter iter;

    if (gtk_tree_model_get_iter_first(model, &iter)) {
        while (&iter) {
            const char *iter_text;
            int match_rating = 0;
            gtk_tree_selection_unselect_iter(selection, &iter);
            gtk_tree_model_get(model, &iter, COLUMN_NAME, &iter_text, -1);

            if (strlen(text) > 1) {
                match_rating = strstr(iter_text, text)?1:0;
            } else {
                match_rating = 0;
            }

            gtk_list_store_set(GTK_LIST_STORE(model), &iter,
                                            COLUMN_MATCH_RATING,
                                            match_rating, -1);
            if (!gtk_tree_model_iter_next(model, &iter))
                break;
        }
    }

}

static gboolean input_key_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(widget));

    if (event->keyval == GDK_KEY_Return) {
        if (strlen(text) > 0) {
            gtk_dialog_response(GTK_DIALOG(data), 1);
        }
    }
    return FALSE; /* Returning 'TRUE' prevents the entry widget from listening */
}

static void cell_data_func (GtkTreeViewColumn *col,
                            GtkCellRenderer   *renderer,
                            GtkTreeModel      *model,
                            GtkTreeIter       *iter,
                            gpointer           user_data)
{
    gchar *label;
    gchar *markuptxt;

    const char *search_text = gtk_entry_get_text(GTK_ENTRY(user_data));

    gtk_tree_model_get(model, iter, COLUMN_NAME, &label, -1);
    char *needle_begin = strstr(label, search_text);

    if (needle_begin && (strlen(search_text) > 1)) {
        size_t needle_len = strlen(search_text);
        char *needle_end = needle_begin + needle_len;
        markuptxt = g_malloc(strlen(label) + 10);
        memset(markuptxt, 0, strlen(label) + 10);
        memcpy(markuptxt, label, needle_end - label);
        sprintf(&markuptxt[needle_begin - label], "<b>%s</b>", search_text);
        memcpy(&markuptxt[(needle_begin - label) + needle_len + 7],
                needle_end, strlen(needle_end));
    } else {
        markuptxt = g_strdup_printf("%s", label);
    }

    g_object_set(renderer, "markup", markuptxt, NULL);
    g_free(markuptxt);
}

static gboolean view_selection_func(GtkTreeSelection *selection,
                               GtkTreeModel     *model,
                               GtkTreePath      *path,
                               gboolean          path_currently_selected,
                               gpointer          userdata)
{
    GtkTreeIter iter;

    if (gtk_tree_model_get_iter(model, &iter, path)) {
        gchar *name;

        gtk_tree_model_get(model, &iter, COLUMN_NAME, &name, -1);

        if (!path_currently_selected) {
            gtk_tree_model_get(model, &iter, COLUMN_ACTION_REF,
                                &selected_action, -1);
            gtk_tree_model_get(model, &iter, COLUMN_SIGNAL,
                                &selected_signal, -1);
        }

        g_free(name);
    }

    return TRUE; /* allow selection state to change */
}

static void list_row_activated_cb(GtkTreeView        *treeview,
                                   GtkTreePath        *path,
                                   GtkTreeViewColumn  *col,
                                   gpointer            userdata)
{
    GtkTreeModel *model;
    GtkTreeIter   iter;

    model = gtk_tree_view_get_model(treeview);

    if (gtk_tree_model_get_iter(model, &iter, path)) {
       gchar *name;

       gtk_tree_model_get(model, &iter, COLUMN_NAME, &name, -1);
       gtk_tree_model_get(model, &iter, COLUMN_ACTION_REF, &selected_action, -1);
       gtk_tree_model_get(model, &iter, COLUMN_SIGNAL, &selected_signal, -1);

       if (selected_action)
           g_print ("Selected action '%s'\n", name);
       if (selected_signal)
           g_print ("Selected signal '^%s'\n", name);

       gtk_dialog_response(GTK_DIALOG(userdata), GTK_RESPONSE_ACCEPT);
       g_free(name);
    }
}

static void guard_op_changed(GtkComboBox *widget, gpointer user_data)
{
    GtkComboBox *combo_box = widget;
    GtkWidget *entry = (GtkWidget *) user_data;

    if (gtk_combo_box_get_active(combo_box) > 1) {
        gtk_widget_set_sensitive(entry, TRUE);
    } else {
        gtk_widget_set_sensitive(entry, FALSE);
    }
}

static int add_action(GtkWindow *parent, struct ufsmm_model *model,
                            void *p_input,
                            enum ufsmm_action_kind kind)
{
    int rc;
    const char *msg;
    GtkWidget *dialog, *vbox, *content_area, *guard_op, *guard_op_value;
    GtkWidget *treeview;
    GtkDialogFlags flags;
    struct ufsmm_actions *list;
    struct ufsmm_action *a;
    struct ufsmm_state *state = (struct ufsmm_state *) p_input;
    struct ufsmm_transition *transition = (struct ufsmm_transition *) p_input;

    selected_action = NULL;
    selected_signal = NULL;

    switch (kind) {
        case UFSMM_ACTION_GUARD:
            msg = "Add guard";
            list = &model->guards;
        break;
        case UFSMM_ACTION_ENTRY:
            msg = "Add entry";
            list = &model->actions;
        break;
        case UFSMM_ACTION_EXIT:
            msg = "Add exit";
            list = &model->actions;
        break;
        case UFSMM_ACTION_ACTION:
            msg = "Add action";
            list = &model->actions;
        break;
        default:
            return -1;
    }

    flags = GTK_DIALOG_MODAL;
    dialog = gtk_dialog_new_with_buttons(msg,
                                       parent,
                                       flags,
                                       "_OK",
                                       1,
                                       "_Cancel",
                                       GTK_RESPONSE_REJECT,
                                       NULL);

    content_area = gtk_dialog_get_content_area(GTK_DIALOG (dialog));

    vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_box_pack_start(GTK_BOX(content_area), vbox, TRUE, TRUE, 0);
    gtk_container_set_border_width(GTK_CONTAINER(vbox), 8);

    GtkWidget *input = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(vbox), input, FALSE, FALSE, 0);

    /* Create list */
    GtkListStore *store;
    GtkTreeIter iter;
    store = gtk_list_store_new (NUM_COLUMNS,
                                G_TYPE_UINT,
                                G_TYPE_STRING,
                                G_TYPE_POINTER,
                                G_TYPE_POINTER);

    TAILQ_FOREACH(a, list, tailq) {
        gtk_list_store_append(store, &iter);
        gtk_list_store_set (store, &iter,
                            COLUMN_MATCH_RATING, 0,
                            COLUMN_NAME, a->name,
                            COLUMN_ACTION_REF, a,
                            -1);
    }

    if (kind != UFSMM_ACTION_GUARD) {
        struct ufsmm_trigger *t;
        TAILQ_FOREACH(t, &model->triggers, tailq) {
            char tmp_buf[1024];
            gtk_list_store_append(store, &iter);
            snprintf(tmp_buf, sizeof(tmp_buf), "^%s", t->name);
            gtk_list_store_set (store, &iter,
                                COLUMN_MATCH_RATING, 0,
                                COLUMN_NAME, tmp_buf,
                                COLUMN_SIGNAL, t,
                                -1);
        }
    }

    gtk_tree_sortable_set_sort_column_id(GTK_TREE_SORTABLE(store),
                                            COLUMN_MATCH_RATING,
                                            GTK_SORT_DESCENDING);

    GtkWidget *scrolled_window = gtk_scrolled_window_new (NULL, NULL);

    treeview = gtk_tree_view_new_with_model(GTK_TREE_MODEL(store));
    gtk_tree_view_set_headers_visible(GTK_TREE_VIEW(treeview), FALSE);
    gtk_tree_view_set_enable_search(GTK_TREE_VIEW(treeview), FALSE);

    GtkCellRenderer *renderer;
    GtkTreeViewColumn *column;

    renderer = gtk_cell_renderer_text_new();

    column = gtk_tree_view_column_new_with_attributes ("Name",
                                                       renderer,
                                                       "text", COLUMN_NAME,
                                                       NULL);
    gtk_tree_view_column_set_cell_data_func(column, renderer,
                                            cell_data_func, input, NULL);
    gtk_tree_view_append_column (GTK_TREE_VIEW(treeview), column);

    gtk_container_add (GTK_CONTAINER (scrolled_window), treeview);
    gtk_widget_set_size_request(scrolled_window, 640, 480);

    gtk_box_pack_start(GTK_BOX(vbox), scrolled_window, TRUE, TRUE, 0);

    GtkTreeSelection *selection = gtk_tree_view_get_selection(GTK_TREE_VIEW(treeview));

    gtk_tree_selection_set_select_function(selection, view_selection_func,
                                            input, NULL);

    if (kind == UFSMM_ACTION_GUARD) {
        GtkWidget *guard_hbox = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
        GtkWidget *lbl = gtk_label_new("Guard expression");
        gtk_box_pack_start(GTK_BOX(guard_hbox), lbl, FALSE, FALSE, 0);
        guard_op = gtk_combo_box_text_new();
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), "True");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), "False");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), "==");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), ">");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), ">=");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), "<");
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(guard_op), "<=");
        gtk_combo_box_set_active(GTK_COMBO_BOX(guard_op), 0);

        guard_op_value = gtk_entry_new();
        gtk_widget_set_sensitive(guard_op_value, FALSE);
        gtk_box_pack_start(GTK_BOX(guard_hbox), guard_op, FALSE, FALSE, 0);
        gtk_box_pack_start(GTK_BOX(guard_hbox), guard_op_value, TRUE, TRUE, 0);
        gtk_box_pack_start(GTK_BOX(vbox), guard_hbox, FALSE, TRUE, 0);

        g_signal_connect(G_OBJECT(guard_op_value), "key_press_event",
                                          G_CALLBACK(input_key_cb),
                                          G_OBJECT(dialog));
    }

    /* Connect signals */
    gtk_widget_show_all(vbox);

    g_signal_connect (guard_op, "changed", G_CALLBACK (guard_op_changed),
                            guard_op_value);

    g_signal_connect(G_OBJECT(input), "changed",
                                      G_CALLBACK(input_changed),
                                      G_OBJECT(treeview));

    g_signal_connect(G_OBJECT(input), "key_press_event",
                                      G_CALLBACK(input_key_cb),
                                      G_OBJECT(dialog));

    g_signal_connect(treeview, "row-activated",
                               G_CALLBACK(list_row_activated_cb),
                               G_OBJECT(dialog));

    int result = gtk_dialog_run(GTK_DIALOG(dialog));
    const char *action_name = gtk_entry_get_text(GTK_ENTRY(input));

    if (strlen(action_name) == 0 && (selected_action != NULL))
        action_name = selected_action->name;

    enum ufsmm_guard_kind guard_kind = UFSMM_GUARD_TRUE;
    int guard_value = 0;

    if (kind == UFSMM_ACTION_GUARD) {
        guard_kind = gtk_combo_box_get_active(GTK_COMBO_BOX(guard_op));
        guard_value = strtoul(gtk_entry_get_text(GTK_ENTRY(guard_op_value)), NULL, 0);
        L_DEBUG("guard_value = %i\n", guard_value);
    }

    L_DEBUG("%p %i", selected_action, result);

    if (selected_action && (result == GTK_RESPONSE_ACCEPT)) {
        uuid_t id;
        uuid_generate_random(id);

        rc = 0;

        switch (kind) {
            case UFSMM_ACTION_ENTRY:
                rc = ufsmm_state_add_entry(model, state, id,
                                                selected_action->id);
            break;
            case UFSMM_ACTION_EXIT:
                rc = ufsmm_state_add_exit(model, state, id,
                                                selected_action->id);
            break;
            case UFSMM_ACTION_ACTION:
                rc = ufsmm_transition_add_action(model, transition, id,
                                                    selected_action->id);
            break;
            case UFSMM_ACTION_GUARD:
                rc = ufsmm_transition_add_guard(model, transition, id,
                                                    selected_action->id,
                                                    guard_kind,
                                                    guard_value);
            break;
            default:
                rc = -1;
            break;
        }
    } else if ((result == 1) && (action_name[0] != '^')) { /* Create new action */
        uuid_t id;
        uuid_generate_random(id);

        rc = ufsmm_model_get_action_by_name(model, action_name, kind,
                                                &selected_action);

        if (rc != UFSMM_OK) {
            /* Create new action */
            rc = ufsmm_model_add_action(model, kind, action_name,
                                            &selected_action);
        }

        if (rc != UFSMM_OK)
            goto err_out;

        switch (kind) {
            case UFSMM_ACTION_ENTRY:
                rc = ufsmm_state_add_entry(model, state, id, selected_action->id);
            break;
            case UFSMM_ACTION_EXIT:
                rc = ufsmm_state_add_exit(model, state, id, selected_action->id);
            break;
            case UFSMM_ACTION_ACTION:
                rc = ufsmm_transition_add_action(model, transition, id,
                                                    selected_action->id);
            break;
            case UFSMM_ACTION_GUARD:
                rc = ufsmm_transition_add_guard(model, transition, id,
                                                    selected_action->id,
                                                    guard_kind,
                                                    guard_value);
            break;
            default:
                rc = -1;
            break;
        }
    } else if (selected_signal && (result == GTK_RESPONSE_ACCEPT)) {
        uuid_t id;
        uuid_generate_random(id);

        rc = 0;

        switch (kind) {
            case UFSMM_ACTION_ENTRY:
                rc = ufsmm_state_add_entry_signal(model, state, id,
                                                selected_signal->id);
            break;
            case UFSMM_ACTION_EXIT:
                rc = ufsmm_state_add_exit_signal(model, state, id,
                                                selected_signal->id);
            break;
            case UFSMM_ACTION_ACTION:
                rc = ufsmm_transition_add_signal_action(model, transition, id,
                                                    selected_signal->id);
            break;
            default:
                rc = -1;
            break;
        }
    } else if (result == 1) {
        uuid_t id;
        uuid_generate_random(id);

        ufsmm_model_add_trigger(model, &action_name[1], &selected_signal);
        rc = 0;

        switch (kind) {
            case UFSMM_ACTION_ENTRY:
                rc = ufsmm_state_add_entry_signal(model, state, id,
                                                selected_signal->id);
            break;
            case UFSMM_ACTION_EXIT:
                rc = ufsmm_state_add_exit_signal(model, state, id,
                                                selected_signal->id);
            break;
            case UFSMM_ACTION_ACTION:
                rc = ufsmm_transition_add_signal_action(model, transition, id,
                                                    selected_signal->id);
            break;
            default:
                rc = -1;
            break;
        }
    } else {
        rc = -1;
    }

err_out:
    gtk_widget_destroy (dialog);

    return rc;
}

int ufsm_add_entry_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_state *state)
{
    return add_action(parent, model, state, UFSMM_ACTION_ENTRY);
}

int ufsm_add_exit_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_state *state)
{
    return add_action(parent, model, state, UFSMM_ACTION_EXIT);
}

int ufsm_add_transition_action_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_transition *transition)
{
    return add_action(parent, model, transition, UFSMM_ACTION_ACTION);
}

int ufsm_add_transition_guard_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_transition *transition)
{
    return add_action(parent, model, transition, UFSMM_ACTION_GUARD);
}
