lib_LTLIBRARIES = libufsm-core.la

libufsm_core_la_SOURCES = ufsm.c \
                          ufsm_debug.c

libufsm_core_la_CFLAGS = -I$(top_srcdir)/include \
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
                           $(CODE_COVERAGE_CFLAGS)

libufsm_core_la_LIBS = $(CODE_COVERAGE_LIBS)

pkgconfigdir = $(libdir)/pkgconfig
pkgconfig_DATA = ufsm-core.pc

pkginclude_HEADERS = $(top_srcdir)/include/ufsm/ufsm.h
