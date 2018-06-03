
UFSMIMPORT ?= ../../../tools/ufsmimport

CC ?= gcc

CFLAGS = -Wall -O2 -I ../../../ -I .
LDFLAGS = -lpthread

UFSM_XMI = dhcp_client_fsm.xmi
UFSM_XMI_OBJS = $(UFSM_XMI:.xmi=.xmio)

C_SRCS  = dhcpc.c dhcpclient.c
C_SRCS += ../../../ufsm.c 
C_SRCS += ../../../ufsm_queue.c 
C_SRCS += ../../../ufsm_stack.c

C_OBJS = $(C_SRCS:.c=.o)

all: dhcpclient

%.xmio : %.xmi
	@echo UFSMIMPORT $< 
	@$(UFSMIMPORT) $< $(patsubst %.xmi, %, $(<))
	@$(CC) $(CFLAGS) -c $(patsubst %.xmi, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

dhcpclient: $(UFSM_XMI_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_XMI_OBJS) $(C_OBJS) $(CFLAGS) $(LDFLAGS) -o $@


clean:
	@rm -f *.o *.xmio
	@$(foreach XMIGEN,$(UFSM_XMI), \
		@rm -f $(patsubst %.xmi, %.[ch], $(XMIGEN)))

