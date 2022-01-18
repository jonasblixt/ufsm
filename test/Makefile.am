COMMON_TEST_CFLAGS = -I $(top_srcdir)/include \
                     -fsanitize=address \
                     -no-pie -g -O0 \
                     -fno-omit-frame-pointer \
                     $(CODE_COVERAGE_CFLAGS)

check_LTLIBRARIES = libnala.la

libnala_la_SOURCES = nala.c
libnala_la_CFLAGS = $(COMMON_TEST_CFLAGS)
