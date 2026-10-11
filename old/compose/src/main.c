#include <stdio.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <unistd.h>
#include <getopt.h>
#include <gtk/gtk.h>
#include <cairo.h>

#include "controller.h"
#include "model/model.h"
#include "render.h"
#include "menu.h"
#include "nav.h"

static unsigned int verbosity = 0;

int ufsmm_debug(enum ufsmm_debug_level debug_level,
              const char *func_name,
              const char *fmt, ...) __attribute__ ((format (printf, 3, 4)));
int ufsmm_debug(enum ufsmm_debug_level debug_level,
              const char *func_name,
              const char *fmt, ...)
{
    va_list args;
    int rc;

    if (verbosity < debug_level)
        return 0;

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
    int opt;
    int long_index = 0;
    int rc = UFSMM_OK;
    struct ufsmm_model *model;


    struct option long_options[] =
    {
        {"verbose",   no_argument,       0,  'v' },
        {"version",   no_argument,       0,  'V' },
        {0,           0,                 0,   0  }
    };

    while ((opt = getopt_long(argc, argv, "vV",
                   long_options, &long_index )) != -1)
    {
        switch (opt)
        {
            case 'v':
                verbosity++;
            break;
            case 'V':
                printf("ufsm-compose %s\n", "TODO!");
                return 0;
            break;
            case '?':
                printf("Unknown option: %c\n", optopt);
                return -1;
            break;
            case ':':
                printf("Missing arg for %c\n", optopt);
                return -1;
            break;
             default:
                exit(EXIT_FAILURE);
        }
    }

    gtk_init(&argc, &argv);
    window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(window), "uFSM compose - " UFSM_VERSION);
    gtk_window_set_position(GTK_WINDOW(window), GTK_WIN_POS_CENTER);
    gtk_window_set_default_size(GTK_WINDOW(window), 1280, 1024);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);
    state_canvas = ufsmm_canvas_new(window, verbosity);

    GtkWidget *main_vbox = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);
    gtk_box_pack_start(GTK_BOX(main_vbox), state_canvas, TRUE, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(window), main_vbox);

    struct stat statbuf;

    char *fn = argv[optind];

    if (fn) {
        if (stat(fn, &statbuf) != 0) {
            rc = ufsmm_model_create(&model, strdup("New model"));
            model->filename = strdup(fn);
        } else {
            rc = ufsmm_model_load(fn, &model);
        }
    } else {
        rc = ufsmm_model_create(&model, strdup("New model"));
        model->filename = strdup("new_model.ufsm");
    }
    if (rc != UFSMM_OK)
    {
        printf("Could not create or load model\n");
        goto err_out;
    }

    ufsmm_canvas_load_model(state_canvas, model);
    gtk_widget_show_all(window);
    gtk_widget_grab_focus(state_canvas);

    gtk_main();
    ufsmm_model_free(model);
err_out:
    return rc;
}
