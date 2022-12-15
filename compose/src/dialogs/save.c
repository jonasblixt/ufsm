#include <gtk/gtk.h>

#include "save.h"

int ufsmm_dialog_save(GtkWindow *parent_window, char **out)
{
    int rc;
    GtkWidget *dialog;

    dialog = gtk_file_chooser_dialog_new("Save File",
                                       parent_window,
                                       GTK_FILE_CHOOSER_ACTION_SAVE,
                                       "Cancel", GTK_RESPONSE_CANCEL,
                                       "OK", GTK_RESPONSE_ACCEPT,
                                       NULL);

    gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog), TRUE);
    gtk_file_chooser_set_current_folder(GTK_FILE_CHOOSER (dialog), "~/");
    gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER (dialog), "new_model.ufsm");

    rc = gtk_dialog_run(GTK_DIALOG(dialog));

    if (rc == GTK_RESPONSE_ACCEPT) {
        char *filename;

        filename = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        (*out) = filename;
    }

    gtk_widget_destroy (dialog);
    return rc;
}
