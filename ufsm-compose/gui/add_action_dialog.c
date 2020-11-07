#include <gtk/gtk.h>
#include <ufsm/model.h>

struct list_data_entry
{
    int match_rating;
    const char *name;
    const struct ufsmm_action *action;
};

enum
{
  COLUMN_MATCH_RATING,
  COLUMN_NAME,
  COLUMN_ACTION_REF,
  NUM_COLUMNS
};

struct list_data_entry entries[] =
{
    {0, "test_function", NULL},
    {0, "pelle", NULL},
    {0, "kalle", NULL},
    {0, "start_timer", NULL},
    {0, "prepare_<b>for</b>_action", NULL},
    {0, "begin_important_work", NULL},
    {0, "check_delicate_state", NULL},
};

static void input_changed(GtkEntry *entry, char *preedit, gpointer user_data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(entry));
    L_DEBUG("Input changed: %s", text);
}

static gboolean input_key_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    if (event->keyval == GDK_KEY_Return) {
        gtk_dialog_response(GTK_DIALOG(data), GTK_RESPONSE_ACCEPT);
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

    gtk_tree_model_get (model, iter, COLUMN_NAME, &label, -1);
    markuptxt = g_strdup_printf("%s", label);
    g_object_set(renderer, "markup", markuptxt, NULL);
    g_free(markuptxt);
}

static int add_action(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_state *state,
                            enum ufsmm_action_kind kind)
{
    int rc;
    const char *msg;
    GtkWidget *dialog, *vbox, *content_area;
    GtkWidget *treeview;
    GtkDialogFlags flags;

    if (kind == UFSMM_ACTION_ENTRY)
        msg = "Add entry action";
    else
        msg = "Add exit action";

    flags = GTK_DIALOG_MODAL;
    dialog = gtk_dialog_new_with_buttons(msg,
                                       parent,
                                       flags,
                                       "_OK",
                                       GTK_RESPONSE_ACCEPT,
                                       "_Cancel",
                                       GTK_RESPONSE_REJECT,
                                       NULL);

    content_area = gtk_dialog_get_content_area(GTK_DIALOG (dialog));

    vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_container_add(GTK_CONTAINER(content_area), vbox);
    gtk_container_set_border_width(GTK_CONTAINER(vbox), 8);

    GtkWidget *input = gtk_entry_new();
    gtk_box_pack_start(GTK_BOX(vbox), input, FALSE, FALSE, 0);

    /* Create list */
    GtkListStore *store;
    GtkTreeIter iter;
    store = gtk_list_store_new (NUM_COLUMNS,
                                G_TYPE_UINT,
                                G_TYPE_STRING,
                                G_TYPE_OBJECT);

    /* Populate list with data */
    for (int i = 0; i < G_N_ELEMENTS(entries); i++) {
        gtk_list_store_append(store, &iter);
        gtk_list_store_set (store, &iter,
                            COLUMN_MATCH_RATING, 0,
                            COLUMN_NAME, entries[i].name,
                            COLUMN_ACTION_REF, entries[i].action,
                            -1);
    }

    treeview = gtk_tree_view_new_with_model(store);
    gtk_tree_view_set_headers_visible(treeview, FALSE);
    gtk_tree_view_set_enable_search(treeview, FALSE);

    GtkCellRenderer *renderer;
    GtkTreeViewColumn *column;

    renderer = gtk_cell_renderer_text_new();
    column = gtk_tree_view_column_new_with_attributes ("Name",
                                                       renderer,
                                                       "text", COLUMN_NAME,
                                                       NULL);
    gtk_tree_view_column_set_sort_column_id(column, COLUMN_MATCH_RATING);
    gtk_tree_view_column_set_cell_data_func(column, renderer,
                                            cell_data_func, NULL, NULL);
    gtk_tree_view_append_column (treeview, column);

    gtk_box_pack_start(GTK_BOX(vbox), treeview, TRUE, TRUE, 0);

    /* Connect signals */
    gtk_widget_show_all(vbox);

    g_signal_connect(G_OBJECT(input), "changed",
                     G_CALLBACK(input_changed), NULL);

    g_signal_connect(G_OBJECT(input), "key_press_event",
                     G_CALLBACK(input_key_cb), G_OBJECT(dialog));

    int result = gtk_dialog_run(GTK_DIALOG(dialog));

    switch (result) {
        case GTK_RESPONSE_ACCEPT:
            rc = 0;
        break;
        default:
            rc = -1;
        break;
    }

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
