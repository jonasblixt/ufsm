lib_LTLIBRARIES = libufsm-model.la

libufsm_model_la_SOURCES = ufsm.c \
                    stack.c \
                    model.c \
                    state.c \
                    transition.c \
                    region.c

libufsm_model_la_CFLAGS = -I$(top_srcdir)/include \
                     $(CODE_COVERAGE_CFLAGS) \
                     $(JSONC_CFLAGS) \
                     $(UUID_CFLAGS)

libufsm_model_la_LIBS = $(JSONC_LIBS) \
                  $(UUID_LIBS) \
                  $(CODE_COVERAGE_LIBS)

pkgconfigdir = $(libdir)/pkgconfig
pkgconfig_DATA = ufsm-model.pc

pkginclude_HEADERS = $(top_srcdir)/include/ufsm/model/ufsmm.h \
                     $(top_srcdir)/include/ufsm/model/model.h \
                     $(top_srcdir)/include/ufsm/model/stack.h
