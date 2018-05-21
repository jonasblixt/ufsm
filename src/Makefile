TARGET = ufsm_test

CC ?= gcc

LDFLAGS = 
CFLAGS  = -Wall 
CFLAGS += -I .

C_SRCS  = ufsm.c
C_SRCS += tests/ufsm_test.c
C_SRCS += tests/simple.c
C_SRCS += tests/simple_substate.c
C_SRCS += tests/test_guards_actions.c
#C_SRCS += tests/orthogonal.c


OBJS = $(C_SRCS:.c=.o)

all: $(TARGET)

ufsm.o: ufsm.h
ufsm_test.o: ufsm.o
simple.o: ufsm.o
simple_substate.o: ufsm.o
test_guards_actions.o: ufsm.o


%.o : %.c
	@echo CC $<
	@$(CC) -c $(CFLAGS) $< -o $@

$(TARGET): $(OBJS)
	@echo LINK $@
	@$(CC) $(LDFLAGS) $(OBJS) -o $@

clean:
	@rm -f $(TARGET)
	@rm -f *.o
	@rm -f tests/*.o
