#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <ufsm/model.h>

#include <gtk/gtk.h>
#include <cairo.h>

#include "controller.h"
#include "render.h"
#include "menu.h"

int ufsmm_debug(enum ufsmm_debug_level debug_level,
              const char *func_name,
              const char *fmt, ...)
{
    va_list args;
    int rc;

    va_start(args, fmt);
    switch (debug_level)
    {
        case 0:
            printf("E ");
        break;
        case 1:
            printf("I ");
        break;
        case 2:
            printf("D ");
        break;
    }
    printf("%s ", func_name);
    vprintf(fmt, args);
    printf("\n");
    va_end(args);
    return rc;
}

int main(int argc, char **argv)
{
    GtkWidget *window;
    GtkWidget *state_canvas;
    int rc = UFSMM_OK;
    struct ufsmm_model *model;

    gtk_init(&argc, &argv);
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "uFSM compose - " PACKAGE_VERSION);
    gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_CENTER);
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 1024);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
    state_canvas = ufsmm_canvas_new(window);
    gtk_container_add(GTK_CONTAINER(window), state_canvas);

    struct stat statbuf;

    if (stat(argv[1], &statbuf) != 0) {
        rc = ufsmm_model_create(&model, "New model");
        model->filename = argv[1];
    } else {
        rc = ufsmm_model_load(argv[1], &model);
    }

    if (rc != UFSMM_OK)
    {
        printf("Could not create or load model\n");
        goto err_out;
    }

    ufsmm_canvas_load_model(state_canvas, model);
    gtk_widget_show_all(window);
    gtk_main();
    ufsmm_model_free(model);
err_out:
    return rc;
}
