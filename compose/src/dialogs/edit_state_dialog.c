#include <gtk/gtk.h>
#include "edit_state_dialog.h"

int ufsm_edit_state_dialog(GtkWindow *parent, struct ufsmm_model *model,
                            struct ufsmm_state *state)
{
    (void) model;
    int rc;
    GtkWidget *dialog, *label, *content_area;
    GtkDialogFlags flags;

    flags = GTK_DIALOG_MODAL;
    dialog = gtk_dialog_new_with_buttons ("Message",
                                       parent,
                                       flags,
                                       "_OK",
                                       GTK_RESPONSE_ACCEPT,
                                       "_Cancel",
                                       GTK_RESPONSE_REJECT,
                                       NULL);
    content_area = gtk_dialog_get_content_area (GTK_DIALOG (dialog));
    label = gtk_label_new(state->name);

    gtk_container_add (GTK_CONTAINER (content_area), label);

    int result = gtk_dialog_run(GTK_DIALOG (dialog));

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
