COMMON_TEST_CFLAGS = -I $(top_srcdir)/include \
                     -I $(top_srcdir)/lib \
                     -fsanitize=address \
                     -DUFSMM_TEST_SRC=\"$(abs_top_srcdir)/test/core/\" \
                     -no-pie -g -O0 \
                     -fno-omit-frame-pointer \
                     $(CODE_COVERAGE_CFLAGS)


COMMON_TEST_LDADD = ../libnala.la \
                    $(top_builddir)/libufsm-core/libufsm-core.la

### ufsm code generation #######################################################

%.gen.c %.gen.h: %.ufsm
	../../ufsm-generate/ufsm-generate --input $^ --output $(@:.c=)

dist_noinst_DATA = test_transition_conflict.ufsm \
				   test_xmi_machine.ufsm \
				   test_deephistory.ufsm \
				   test_nested_composits.ufsm \
				   test_nested_composits2.ufsm \
				   test_join2.ufsm \
				   test_ev_repeat_orth.ufsm \
				   test_fork.ufsm \
				   test_terminate.ufsm \
				   test_guards2.ufsm \
				   test_state_conditions.ufsm \
				   test_join3.ufsm \
				   test_nested_states.ufsm \
				   test_nested_states2.ufsm

MOSTLYCLEANFILES = test_transition_conflict.gen.c test_transition_conflict.gen.h \
				   test_xmi_machine.gen.c test_xmi_machine.gen.h \
				   test_deephistory.gen.c test_deephistory.gen.h \
				   test_nested_composits.gen.c test_nested_composits.gen.h \
				   test_nested_composits2.gen.c test_nested_composits2.gen.h \
				   test_join2.gen.c test_join2.gen.h \
				   test_transition_prio.gen.c test_transition_prio.gen.h \
				   test_ev_repeat_orth.gen.c test_ev_repeat_orth.gen.h \
				   test_fork.gen.c test_fork.gen.h \
				   test_terminate.gen.c test_terminate.gen.h \
				   test_guards2.gen.c test_guards2.gen.h \
				   test_state_conditions.gen.c test_state_conditions.gen.h \
				   test_join3.gen.c test_join3.gen.h \
				   test_nested_states.gen.c test_nested_states.gen.h \
				   test_nested_states2.gen.c test_nested_states2.gen.h

BUILTSOURCES: test_transition_conflict.gen.c test_transition_conflict.gen.h \
		      test_xmi_machine.gen.c test_xmi_machine.gen.h \
			  test_deephistory.gen.c test_deephistroy.gen.h \
			  test_nested_composits.gen.c test_nested_composits.gen.h \
			  test_nested_composits2.gen.c test_nested_composits2.gen.h \
			  test_join2.gen.c test_join2.gen.h \
			  test_transition_prio.gen.c test_transition_prio.gen.h \
			  test_ev_repeat_orth.gen.c test_ev_repeat_orth.gen.h \
			  test_fork.gen.c test_fork.gen.h \
			  test_terminate.gen.c test_terminate.gen.h \
			  test_guards2.gen.c test_guards2.gen.h \
			  test_state_conditions.gen.c test_state_conditions.gen.h \
			  test_join3.gen.c test_join3.gen.h \
			  test_nested_states.gen.c test_nested_states.gen.h \
			  test_nested_states2.gen.c test_nested_states2.gen.h

################################################################################

check_PROGRAMS = test_simple \
                 test_simple_substate \
                 test_simple_completion \
                 test_guards_actions \
                 test_transition_conflict \
				 test_xmi_machine \
				 test_deephistory \
				 test_nested_composits \
				 test_nested_composits2 \
				 test_join2 \
				 test_transition_prio \
				 test_ev_repeat_orth \
				 test_fork \
				 test_terminate \
				 test_guards2 \
				 test_state_conditions \
				 test_join3 \
				 test_nested_states \
				 test_nested_states2

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

test_nested_composits.c: test_nested_composits.gen.c
test_nested_composits_SOURCES = test_nested_composits.c \
						   $(builddir)/test_nested_composits.gen.c
test_nested_composits_LDADD = $(COMMON_TEST_LDADD)
test_nested_composits_CFLAGS = $(COMMON_TEST_CFLAGS)

test_nested_composits2.c: test_nested_composits2.gen.c
test_nested_composits2_SOURCES = test_nested_composits2.c \
						   $(builddir)/test_nested_composits2.gen.c
test_nested_composits2_LDADD = $(COMMON_TEST_LDADD)
test_nested_composits2_CFLAGS = $(COMMON_TEST_CFLAGS)

test_join2.c: test_join2.gen.c
test_join2_SOURCES = test_join2.c $(builddir)/test_join2.gen.c
test_join2_LDADD = $(COMMON_TEST_LDADD)
test_join2_CFLAGS = $(COMMON_TEST_CFLAGS)

test_join3.c: test_join3.gen.c
test_join3_SOURCES = test_join3.c $(builddir)/test_join3.gen.c
test_join3_LDADD = $(COMMON_TEST_LDADD)
test_join3_CFLAGS = $(COMMON_TEST_CFLAGS)

test_fork.c: test_fork.gen.c
test_fork_SOURCES = test_fork.c $(builddir)/test_fork.gen.c
test_fork_LDADD = $(COMMON_TEST_LDADD)
test_fork_CFLAGS = $(COMMON_TEST_CFLAGS)

test_transition_prio.c: test_transition_prio.gen.c
test_transition_prio_SOURCES = test_transition_prio.c $(builddir)/test_transition_prio.gen.c
test_transition_prio_LDADD = $(COMMON_TEST_LDADD)
test_transition_prio_CFLAGS = $(COMMON_TEST_CFLAGS)

test_ev_repeat_orth.c: test_ev_repeat_orth.gen.c
test_ev_repeat_orth_SOURCES = test_ev_repeat_orth.c $(builddir)/test_ev_repeat_orth.gen.c
test_ev_repeat_orth_LDADD = $(COMMON_TEST_LDADD)
test_ev_repeat_orth_CFLAGS = $(COMMON_TEST_CFLAGS)

test_terminate.c: test_terminate.gen.c
test_terminate_SOURCES = test_terminate.c $(builddir)/test_terminate.gen.c
test_terminate_LDADD = $(COMMON_TEST_LDADD)
test_terminate_CFLAGS = $(COMMON_TEST_CFLAGS)

test_guards2.c: test_guards2.gen.c
test_guards2_SOURCES = test_guards2.c $(builddir)/test_guards2.gen.c
test_guards2_LDADD = $(COMMON_TEST_LDADD)
test_guards2_CFLAGS = $(COMMON_TEST_CFLAGS)

test_state_conditions.c: test_state_conditions.gen.c
test_state_conditions_SOURCES = test_state_conditions.c $(builddir)/test_state_conditions.gen.c
test_state_conditions_LDADD = $(COMMON_TEST_LDADD)
test_state_conditions_CFLAGS = $(COMMON_TEST_CFLAGS)

test_nested_states.c: test_nested_states.gen.c
test_nested_states_SOURCES = test_nested_states.c $(builddir)/test_nested_states.gen.c
test_nested_states_LDADD = $(COMMON_TEST_LDADD)
test_nested_states_CFLAGS = $(COMMON_TEST_CFLAGS)

test_nested_states2.c: test_nested_states2.gen.c
test_nested_states2_SOURCES = test_nested_states2.c $(builddir)/test_nested_states2.gen.c
test_nested_states2_LDADD = $(COMMON_TEST_LDADD)
test_nested_states2_CFLAGS = $(COMMON_TEST_CFLAGS)

TESTS = test_simple \
        test_simple_substate \
        test_simple_completion \
        test_guards_actions \
        test_transition_conflict \
		test_xmi_machine \
		test_deephistory \
		test_nested_composits \
		test_nested_composits2 \
		test_join2 \
		test_transition_prio \
		test_ev_repeat_orth \
		test_fork \
		test_terminate \
		test_guards2 \
		test_state_conditions \
		test_join3 \
		test_nested_states
