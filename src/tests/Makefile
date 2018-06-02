TESTS  = test_simple
TESTS += test_simple_substate
TESTS += test_guards_actions
TESTS += test_compound_transition
TESTS += test_xmi_machine
TESTS += test_deephistory
TESTS += test_fork
TESTS += test_join
TESTS += test_stack
TESTS += test_choice
TESTS += test_queue
TESTS += test_junction
TESTS += test_deferr
TESTS += test_terminate


CC ?= gcc
UFSMIMPORT ?= ufsmimport

UFSM_TESTS_VERBOSE ?= false

LDFLAGS = -lgcov
CFLAGS  = -O2 -Wall -std=c99 -fprofile-arcs -ftest-coverage
CFLAGS += -I.. -I. -I gen/ -DUFSM_TESTS_VERBOSE=$(UFSM_TESTS_VERBOSE)

C_SRCS = ../ufsm.c ../ufsm_stack.c ../ufsm_queue.c common.c
OBJS = $(C_SRCS:.c=.o)

all: $(TESTS)
	@$(foreach TEST,$(TESTS), \
		echo && \
		echo "TEST $(TEST)" && \
		./$(TEST))
	@echo "*** ALL $(words ${TESTS}) TESTS PASSED ***"
%.o : %.c
	@echo CC $<
	@$(CC) -c $(CFLAGS) $< -o $@

%.c : %.xmi
	@echo UFSMIMPORT $< 
	@mkdir -p gen
	@$(UFSMIMPORT) $< $(patsubst %.xmi, %, $(<)) -c gen/

clean:
	@$(foreach TEST,$(TESTS), rm -f $(TEST);)
	@rm -rf gen/
	@rm -f *.o
	@rm -f *.gcda 
	@rm -f *.gcno
	@rm -f *.gcov

# TEST DEFINITIONS ###########################################################

test_xmi_machine: $(OBJS) test_xmi_machine_input.c test_xmi_machine.o
	@echo LINK $@
	@$(CC) $@.c gen/test_xmi_machine_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_fork: $(OBJS) test_fork_input.c test_fork.o
	@echo LINK $@
	@$(CC) $@.c gen/test_fork_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_join: $(OBJS) test_join_input.c test_join.o
	@echo LINK $@
	@$(CC) $@.c gen/test_join_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_compound_transition: $(OBJS) test_compound_transition_input.c test_compound_transition.o
	@echo LINK $@
	@$(CC) $@.c gen/test_compound_transition_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_deephistory: $(OBJS) test_deephistory_input.c test_deephistory.o
	@echo LINK $@
	@$(CC) $@.c gen/test_deephistory_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_simple: $(OBJS) test_simple.o
	@echo LINK $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_simple_substate: $(OBJS) test_simple_substate.o
	@echo LINK $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_guards_actions: $(OBJS) test_guards_actions.o
	@echo LINK $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_stack: $(OBJS) test_stack.o
	@echo LINK $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_choice: $(OBJS) test_choice_input.c test_choice.o
	@echo LINK $@
	@$(CC) $@.c gen/test_choice_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_queue: $(OBJS) test_queue.o
	@echo LINK $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_junction: $(OBJS) test_junction_input.c test_junction.o
	@echo LINK $@
	@$(CC) $@.c gen/test_junction_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_deferr: $(OBJS) test_deferr_input.c test_deferr.o
	@echo LINK $@
	@$(CC) $@.c gen/test_deferr_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_terminate: $(OBJS) test_terminate_input.c test_terminate.o
	@echo LINK $@
	@$(CC) $@.c gen/test_terminate_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@


