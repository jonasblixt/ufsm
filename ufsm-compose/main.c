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
#include "nav.h"

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
/*
    GtkWidget *main_hpane = gtk_paned_new(GTK_ORIENTATION_HORIZONTAL);
    nav_tree = ufsmm_nav_init();
    gtk_paned_add1(GTK_PANED(main_hpane), nav_tree);
    gtk_paned_add2(GTK_PANED(main_hpane), state_canvas);
    gtk_paned_set_position(GTK_PANED(main_hpane), 512);
*/
    GtkWidget *main_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_box_pack_start(GTK_BOX(main_vbox), state_canvas, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(window), main_vbox);

    struct stat statbuf;

    if (stat(argv[1], &statbuf) != 0) {
        rc = ufsmm_model_create(&model, strdup("New model"));
        model->filename = strdup(argv[1]);
    } else {
        rc = ufsmm_model_load(argv[1], &model);
    }

    if (rc != UFSMM_OK)
    {
        printf("Could not create or load model\n");
        goto err_out;
    }

    ufsmm_canvas_load_model(state_canvas, model);
//    ufsmm_nav_update(model);
    gtk_widget_show_all(window);
    gtk_widget_grab_focus(state_canvas);
//    gtk_widget_hide(nav_tree);

    gtk_main();
    ufsmm_model_free(model);
err_out:
    return rc;
}
