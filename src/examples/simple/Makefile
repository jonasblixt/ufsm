UFSMIMPORT ?= ufsmimport

CC ?= gcc

CFLAGS = -Wall -O2 -I ../../ -I .
LDFLAGS = 

UFSM_XMI = ufsm_demo_fsm.xmi
UFSM_XMI_OBJS = $(UFSM_XMI:.xmi=.xmio)

C_SRCS  = simple.c
C_SRCS += ../../ufsm.c 
C_SRCS += ../../ufsm_queue.c 
C_SRCS += ../../ufsm_stack.c

C_OBJS = $(C_SRCS:.c=.o)

all: simple

%.xmio : %.xmi
	@echo UFSMIMPORT $< 
	@$(UFSMIMPORT) $< $(patsubst %.xmi, %, $(<))
	@$(CC) $(CFLAGS) -c $(patsubst %.xmi, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

simple: $(UFSM_XMI_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_XMI_OBJS) $(C_OBJS) $(CFLAGS) $(LDFLAGS) -o $@


clean:
	@rm -f *.o *.xmio
	@rm -f simple
	@$(foreach XMIGEN,$(UFSM_XMI), \
		@rm -f $(patsubst %.xmi, %.[ch], $(XMIGEN)))

