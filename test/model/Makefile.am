
COMMON_TEST_CFLAGS = -I $(top_srcdir)/include \
                     -I $(top_srcdir)/lib \
                     -fsanitize=address \
                     $(JSONC_CFLAGS) \
                     $(UUID_CFLAGS) \
                     -DSOTC_TEST_SRC=\"$(abs_top_srcdir)/test/\" \
                     -no-pie -g -O0 \
                     -fno-omit-frame-pointer

COMMON_TEST_LDADD = libnala.la \
                    $(top_builddir)/lib/libsotc.la \
                    $(JSONC_LIBS) \
                    $(UUID_LIBS)

check_LTLIBRARIES = libnala.la

libnala_la_SOURCES = nala.c
libnala_la_CFLAGS = $(COMMON_TEST_CFLAGS)

check_PROGRAMS = test1 \
                 test_stack \
                 test_model \
                 test_actions \
                 test_transitions \
                 test_triggers

test1_SOURCES = common.c test1.c
test1_LDADD = $(COMMON_TEST_LDADD)
test1_CFLAGS = $(COMMON_TEST_CFLAGS)

test_stack_SOURCES = common.c test_stack.c
test_stack_LDADD = $(COMMON_TEST_LDADD)
test_stack_CFLAGS = $(COMMON_TEST_CFLAGS)

test_model_SOURCES = common.c test_model.c
test_model_LDADD = $(COMMON_TEST_LDADD)
test_model_CFLAGS = $(COMMON_TEST_CFLAGS)

test_actions_SOURCES = common.c test_actions.c
test_actions_LDADD = $(COMMON_TEST_LDADD)
test_actions_CFLAGS = $(COMMON_TEST_CFLAGS)

test_triggers_SOURCES = common.c test_triggers.c
test_triggers_LDADD = $(COMMON_TEST_LDADD)
test_triggers_CFLAGS = $(COMMON_TEST_CFLAGS)

test_transitions_SOURCES = common.c test_transitions.c
test_transitions_LDADD = $(COMMON_TEST_LDADD)
test_transitions_CFLAGS = $(COMMON_TEST_CFLAGS)

TESTS = test1 \
        test_stack \
        test_model \
        test_actions \
        test_triggers \
        test_transitions
