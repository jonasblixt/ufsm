UFSMGENERATE ?= ufsm-generate

CC ?= gcc
CFLAGS = -Wall -O2 -I .

UFSM_MODEL = linux_async.ufsm
UFSM_MODEL_OBJS = $(UFSM_MODEL:.ufsm=.ufsmo)

C_SRCS  = main.c queue.c timer.c
C_OBJS = $(C_SRCS:.c=.o)

all: linux_async

%.ufsmo : %.ufsm
	@echo UFSMGEN $< 
	@$(UFSMGENERATE) -v2 c -l 8 $< .
	@$(CC) $(CFLAGS) -c $(patsubst %.ufsm, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

linux_async: $(UFSM_MODEL_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_MODEL_OBJS) $(C_OBJS) $(CFLAGS) -o $@


clean:
	@rm -f *.o *.ufsmo
	@rm -f linux_async
	@$(foreach UFSMGEN,$(UFSM_MODEL), \
		@rm -f $(patsubst %.ufsm, %.[ch], $(UFSMGEN)))

