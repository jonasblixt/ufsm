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
    //GtkWidget *object_tree;

    int rc = UFSMM_OK;
    struct ufsmm_model *model;

    gtk_init(&argc, &argv);
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "uFSM compose - " PACKAGE_VERSION);
    gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_CENTER);
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 1024);

    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

    GtkWidget *center_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);

    GtkWidget *menubar = gtk_menu_bar_new();
    gtk_widget_set_hexpand(menubar, TRUE);
    gtk_box_pack_start(GTK_BOX(center_vbox), menubar, FALSE, TRUE, 0);
    gtk_widget_show(menubar);

    GtkWidget *menuitem = gtk_menu_item_new_with_mnemonic("_File");
    gtk_menu_shell_append(GTK_MENU_SHELL(menubar), menuitem);
    gtk_widget_show(menuitem);

    menuitem = gtk_menu_item_new_with_mnemonic("_Edit");
    gtk_menu_shell_append(GTK_MENU_SHELL(menubar), menuitem);
    gtk_widget_show(menuitem);

    menuitem = gtk_menu_item_new_with_mnemonic("_View");
    gtk_menu_shell_append(GTK_MENU_SHELL(menubar), menuitem);
    gtk_widget_show(menuitem);

    menuitem = gtk_menu_item_new_with_mnemonic("_Place");
    gtk_menu_shell_append(GTK_MENU_SHELL(menubar), menuitem);
    gtk_widget_show(menuitem);

    GtkWidget *place_menu = gtk_menu_new();
    gtk_menu_item_set_submenu(GTK_MENU_ITEM(menuitem), place_menu);

    menuitem = gtk_menu_item_new_with_mnemonic("_State");
    gtk_menu_shell_append(GTK_MENU_SHELL(place_menu), menuitem);

    menuitem = gtk_menu_item_new_with_mnemonic("_Transition");
    gtk_menu_shell_append(GTK_MENU_SHELL(place_menu), menuitem);

    menuitem = gtk_menu_item_new_with_mnemonic("_Initial State");
    gtk_menu_shell_append(GTK_MENU_SHELL(place_menu), menuitem);

    GtkWidget *hpane = gtk_paned_new(GTK_ORIENTATION_HORIZONTAL);

    state_canvas = ufsmm_canvas_new(window);

    gtk_paned_add2(GTK_PANED(hpane), state_canvas);

    gtk_box_pack_start(GTK_BOX(center_vbox), hpane, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(window), center_vbox);


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

    //ufsmm_state_canvas_update(model, NULL, argv[1]);
    ufsmm_canvas_load_model(state_canvas, model);

    gtk_widget_show_all(window);
    gtk_main();

    printf("Clean-up...\n");
    ufsmm_model_free(model);

err_out:
    return rc;
}
