#include <gtk/gtk.h>
#include "edit_string_dialog.h"

static gboolean input_key_cb(GtkWidget *widget, GdkEventKey *event, gpointer data)
{
    const char *text = gtk_entry_get_text(GTK_ENTRY(widget));

    if (event->keyval == GDK_KEY_Return) {
        if (strlen(text) > 0) {
            gtk_dialog_response(GTK_DIALOG(data), GTK_RESPONSE_ACCEPT);
        }
    }
    return FALSE; /* Returning 'TRUE' prevents the entry widget from listening */
}

int ufsm_edit_string_dialog(GtkWindow *parent,
                            const char *dialog_name,
                            const char **output)
{
    int rc;
    GtkWidget *dialog, *vbox, *content_area;
    GtkDialogFlags flags;

    flags = GTK_DIALOG_MODAL;
    dialog = gtk_dialog_new_with_buttons (dialog_name,
                                       parent,
                                       flags,
                                       "_OK",
                                       GTK_RESPONSE_ACCEPT,
                                       "_Cancel",
                                       GTK_RESPONSE_REJECT,
                                       NULL);
    content_area = gtk_dialog_get_content_area (GTK_DIALOG (dialog));

    vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 8);
    gtk_container_add(GTK_CONTAINER(content_area), vbox);
    gtk_container_set_border_width(GTK_CONTAINER(vbox), 8);

    GtkWidget *input = gtk_entry_new();

    gtk_box_pack_start(GTK_BOX(vbox), input, FALSE, FALSE, 0);
    if (*output) {
        gtk_entry_set_text(GTK_ENTRY(input), *output);
    }

    gtk_widget_show_all(vbox);

    g_signal_connect(G_OBJECT(input), "key_press_event",
                                      G_CALLBACK(input_key_cb),
                                      G_OBJECT(dialog));

    int result = gtk_dialog_run(GTK_DIALOG (dialog));

    switch (result) {
        case GTK_RESPONSE_ACCEPT:
        {
            const char *text = gtk_entry_get_text(GTK_ENTRY(input));
            if (*output != NULL) {
                free((void *) *output);
            }
            *output = strdup(text);
            rc = 0;
        }
        break;
        default:
            rc = -1;
        break;
    }

    gtk_widget_destroy (dialog);

    return rc;
}
