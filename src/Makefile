TARGET = ufsm_test

CC ?= gcc

LDFLAGS = 
CFLAGS  = -Wall 
CFLAGS += -I .

C_SRCS  = ufsm.c
C_SRCS += tests/ufsm_test.c
C_SRCS += tests/simple.c
C_SRCS += tests/orthogonal.c


OBJS = $(C_SRCS:.c=.o)

all: $(TARGET)

%.o : %.c
	@echo CC $<
	@$(CC) -c $(CFLAGS) $< -o $@

$(TARGET): $(OBJS)
	@$(CC) $(LDFLAGS) $(OBJS) -o $@

clean:
	@rm -f $(TARGET)
	@rm -f *.o
	@rm -f tests/*.o
