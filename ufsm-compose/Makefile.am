bin_PROGRAMS = ufsm-compose

ufsm_compose_SOURCES = main.c \
               gui/edit_state_dialog.c \
               gui/add_action_dialog.c \
			   gui/add_guard_dialog.c \
               gui/edit_string_dialog.c \
               gui/set_trigger_dialog.c \
			   utils.c \
               render.c \
               logic/canvas.c \
               controller.c \
			   pan_and_scale.c \
			   copypaste.c \
			   undo.c


ufsm_compose_CFLAGS = -I$(top_srcdir)/include \
              -DGTK_DISABLE_DEPRECATED \
              -DGLIB_DISABLE_DEPRECATED \
              -I/usr/include \
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

