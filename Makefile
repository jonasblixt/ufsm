
all:
	@make -C src/tools
	@UFSMIMPORT=../tools/ufsmimport make UFSM_TESTS_VERBOSE=true -C src/tests
clean:
	@make -C src/tools clean
	@make -C src/tests clean
	@make -C src clean

format:
	find src/ -maxdepth 1 -iname *.h -o -iname *.c | xargs clang-format -i
