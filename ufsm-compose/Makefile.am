bin_PROGRAMS = ufsm-compose

ufsm_compose_SOURCES = main.c \
               dialogs/edit_state_dialog.c \
               dialogs/add_action_dialog.c \
               dialogs/add_guard_dialog.c \
               dialogs/edit_string_dialog.c \
               dialogs/set_trigger_dialog.c \
               dialogs/save.c \
               dialogs/project_settings.c \
               utils.c \
               render.c \
               logic/canvas.c \
               controller.c \
               pan_and_scale.c \
               copypaste.c \
               undo.c \
               menu.c \
               nav.c \
               status.c


ufsm_compose_CFLAGS = -I$(top_srcdir)/include \
              -DGTK_DISABLE_DEPRECATED \
              -DGLIB_DISABLE_DEPRECATED \
              -I/usr/include \
              -pedantic \
                -Wall \
                -Wextra \
                -Wunused-result \
                -Wunused \
                -Wdisabled-optimization \
                -Wvla \
                -Wshadow \
                -Wno-unused-parameter \
                -Wextra \
                -Wmissing-format-attribute \
                -Wmissing-prototypes \
                -Wpointer-arith \
                -Waggregate-return \
              $(JSONC_CFLAGS) \
              $(GTK_CFLAGS) \
              $(CAIRO_CFLAGS) \
              $(UUID_CFLASG)

ufsm_compose_LDFLAGS =

ufsm_compose_LDADD = $(top_builddir)/libufsm-model/libufsm-model.la \
                     $(top_builddir)/libufsm-core/libufsm-core.la \
                     $(JSONC_LIBS) \
                     $(GTK_LIBS) \
                     $(CAIRO_LIBS) \
                     $(UUID_LIBS) \
                     -lm

