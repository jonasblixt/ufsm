TESTS  = test_simple
TESTS += test_simple_substate
TESTS += test_guards_actions
TESTS += test_xmi_machine

CC ?= gcc
UFSMIMPORT ?= ufsmimport

LDFLAGS = 
CFLAGS  = -Wall 
CFLAGS += -I.. -I. -I gen/

C_SRCS = ../ufsm.c

OBJS = $(C_SRCS:.c=.o)

all: $(TESTS)
	@$(foreach TEST,$(TESTS), \
		echo && \
		echo TEST $(TEST) && \
		./$(TEST))
	@echo
	@echo "*** ALL TESTS PASSED ***"

%.o : %.c
	@echo CC $<
	@$(CC) -c $(CFLAGS) $< -o $@

%.c : %.xmi
	@echo UFSMIMPORT $< 
	@mkdir -p gen
	@$(UFSMIMPORT) $< $(patsubst %.xmi, %, $(<)) -c gen/

clean:
	@$(foreach TEST,$(TESTS), rm $(TEST);)
	@rm -rf gen/
	@rm -f *.o

# TEST DEFINITIONS ###########################################################

test_xmi_machine: $(OBJS) test_xmi_machine_input.c test_xmi_machine.o
	@echo BUILD $@
	@$(CC) $@.c gen/test_xmi_machine_input.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_simple: $(OBJS) test_simple.o
	@echo BUILD $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_simple_substate: $(OBJS) test_simple_substate.o
	@echo BUILD $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

test_guards_actions: $(OBJS) test_guards_actions.o
	@echo BUILD $@
	@$(CC) $@.c $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

