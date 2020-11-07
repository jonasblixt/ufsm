lib_LTLIBRARIES = libufsm-core.la

libufsm_core_la_SOURCES = ufsm.c \
                          ufsm_debug.c

libufsm_core_la_CFLAGS = -I$(top_srcdir)/include \
                           $(CODE_COVERAGE_CFLAGS)

libufsm_core_la_LIBS = $(CODE_COVERAGE_LIBS)

pkgconfigdir = $(libdir)/pkgconfig
pkgconfig_DATA = ufsm-core.pc

pkginclude_HEADERS = $(top_srcdir)/include/ufsm/ufsm.h
