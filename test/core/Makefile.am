COMMON_TEST_CFLAGS = -I $(top_srcdir)/include \
                     -I $(top_srcdir)/lib \
                     -fsanitize=address \
                     -DUFSMM_TEST_SRC=\"$(abs_top_srcdir)/test/core/\" \
                     -no-pie -g -O0 \
                     -fno-omit-frame-pointer

COMMON_TEST_LDADD = ../libnala.la \
                    $(top_builddir)/libufsm-core/libufsm-core.la

### ufsm code generation #######################################################

%.gen.c %.gen.h: %.ufsm
	../../ufsm-generate/ufsm-generate --input $^ --output $(@:.c=)

dist_noinst_DATA = test_transition_conflict.ufsm \
				   test_xmi_machine.ufsm \
				   test_deephistory.ufsm

MOSTLYCLEANFILES = test_transition_conflict.gen.c test_transition_conflict.gen.h \
				   test_xmi_machine.gen.c test_xmi_machine.gen.h \
				   test_deephistory.gen.c test_deephistory.gen.h

BUILTSOURCES: test_transition_conflict.gen.c test_transition_conflict.gen.h \
		      test_xmi_machine.gen.c test_xmi_machine.gen.h \
			  test_deephistory.gen.c test_deephistroy.gen.h

################################################################################

check_PROGRAMS = test_simple \
                 test_simple_substate \
                 test_simple_completion \
                 test_guards_actions \
                 test_transition_conflict \
				 test_xmi_machine \
				 test_deephistory

test_simple_SOURCES = test_simple.c
test_simple_LDADD = $(COMMON_TEST_LDADD)
test_simple_CFLAGS = $(COMMON_TEST_CFLAGS)

test_simple_substate_SOURCES = test_simple_substate.c
test_simple_substate_LDADD = $(COMMON_TEST_LDADD)
test_simple_substate_CFLAGS = $(COMMON_TEST_CFLAGS)

test_simple_completion_SOURCES = test_simple_completion.c
test_simple_completion_LDADD = $(COMMON_TEST_LDADD)
test_simple_completion_CFLAGS = $(COMMON_TEST_CFLAGS)

test_guards_actions_SOURCES = test_guards_actions.c
test_guards_actions_LDADD = $(COMMON_TEST_LDADD)
test_guards_actions_CFLAGS = $(COMMON_TEST_CFLAGS)

test_transition_conflict.c: test_transition_conflict.gen.c
test_transition_conflict_SOURCES = test_transition_conflict.c \
								   $(builddir)/test_transition_conflict.gen.c
test_transition_conflict_LDADD = $(COMMON_TEST_LDADD)
test_transition_conflict_CFLAGS = $(COMMON_TEST_CFLAGS)

test_xmi_machine.c: test_xmi_machine.gen.c
test_xmi_machine_SOURCES = test_xmi_machine.c \
						   $(builddir)/test_xmi_machine.gen.c
test_xmi_machine_LDADD = $(COMMON_TEST_LDADD)
test_xmi_machine_CFLAGS = $(COMMON_TEST_CFLAGS)

test_deephistory.c: test_deephistory.gen.c
test_deephistory_SOURCES = test_deephistory.c \
						   $(builddir)/test_deephistory.gen.c
test_deephistory_LDADD = $(COMMON_TEST_LDADD)
test_deephistory_CFLAGS = $(COMMON_TEST_CFLAGS)

TESTS = test_simple \
        test_simple_substate \
        test_simple_completion \
        test_guards_actions \
        test_transition_conflict \
		test_xmi_machine \
		test_deephistory
