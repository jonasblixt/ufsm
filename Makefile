
all:
	@make -C src/tools
	@UFSMIMPORT=../tools/ufsmimport make -C src/tests
clean:
	@make -C src/tools clean
	@make -C src/tests clean
	@make -C src clean

format:
	find src/ -iname *.h -o -iname *.c | xargs clang-format -i
