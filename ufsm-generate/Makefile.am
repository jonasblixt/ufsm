bin_PROGRAMS = ufsm-generate

ufsm_generate_SOURCES = main.c \
                        output.c


ufsm_generate_CFLAGS = -I$(top_srcdir)/include \
                       $(JSONC_CFLAGS) \
                       $(UUID_CFLASG)

ufsm_generate_LDFLAGS =

ufsm_generate_LDADD = $(top_builddir)/libufsm-model/libufsm-model.la \
                      $(JSONC_LIBS) \
                      $(UUID_LIBS)

