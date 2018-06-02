
UFSMIMPORT ?= ../../../tools/ufsmimport

CC ?= gcc

CFLAGS = -Wall -O2 -O -I ../../../ -I .
LDFLAGS = -lpthread

UFSM_XMI = dhcp_client_fsm.xmi
UFSM_XMI_OBJS = $(UFSM_XMI:.xmi=.xmio)

C_SRCS  = dhcpclient.c 
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
	@$(CC) -c $(CFLAGS) $< -o $@

dhcpclient: $(UFSM_XMI_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_XMI_OBJS) $(C_OBJS) $(CFLAGS) $(LDFLAGS) -o $@


clean:
	@rm -f *.o *.xmio
	@$(foreach XMIGEN,$(UFSM_XMI), \
		@rm -f $(patsubst %.xmi, %.[ch], $(XMIGEN)))

