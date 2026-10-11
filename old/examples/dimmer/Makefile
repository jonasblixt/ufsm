UFSMGENERATE ?= ufsm-generate

CC ?= gcc
CFLAGS = -Wall -O2 -I .

UFSM_MODEL = dimmer.ufsm
UFSM_MODEL_OBJS = $(UFSM_MODEL:.ufsm=.ufsmo)

C_SRCS  = main.c
C_OBJS = $(C_SRCS:.c=.o)

all: dimmer

%.ufsmo : %.ufsm
	@echo UFSMGEN $< 
	@$(UFSMGENERATE) -v2 c $< .
	@$(CC) $(CFLAGS) -c $(patsubst %.ufsm, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

dimmer: $(UFSM_MODEL_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_MODEL_OBJS) $(C_OBJS) $(CFLAGS) -o $@


clean:
	@rm -f *.o *.ufsmo
	@rm -f dimmer
	@$(foreach UFSMGEN,$(UFSM_MODEL), \
		@rm -f $(patsubst %.ufsm, %.[ch], $(UFSMGEN)))

