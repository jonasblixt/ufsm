bin_PROGRAMS = ufsm-generate

ufsm_generate_SOURCES = main.c \
                        output.c


ufsm_generate_CFLAGS = -I$(top_srcdir)/include \
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
                       $(UUID_CFLASG)

ufsm_generate_LDFLAGS =

ufsm_generate_LDADD = $(top_builddir)/libufsm-model/libufsm-model.la \
                      $(JSONC_LIBS) \
                      $(UUID_LIBS)

