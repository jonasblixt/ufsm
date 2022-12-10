CC ?= gcc
UFSM_GEN ?= ufsm-generate

CFLAGS = -Wall -pedantic -O2

TESTS = test_model1 \
		test_nested_states3 \
		test_nested_states4 \
		test_fork_join \
		test_nested_finals2

all: $(TESTS) run

$(TESTS):
	@mkdir -p gen/
	@$(UFSM_GEN) C $@.ufsm gen/
	@$(CC) $(CFLAGS) $@.c test_helper.c gen/$@.c -o $@

run:
	@$(foreach TEST,$(TESTS), \
		echo && \
		echo "TEST $(TEST)" && \
		./$(TEST))
	@echo "*** ALL $(words ${TESTS}) TESTS PASSED ***"

clean:
	@rm -f *.o $(TESTS)
	@rm -f gen/*
