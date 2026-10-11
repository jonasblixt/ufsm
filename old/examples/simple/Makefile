UFSMGENERATE ?= ufsm-generate

CC ?= gcc
CFLAGS = -Wall -O2 -I .

UFSM_MODEL = led.ufsm
UFSM_MODEL_OBJS = $(UFSM_MODEL:.ufsm=.ufsmo)

C_SRCS  = simple.c
C_OBJS = $(C_SRCS:.c=.o)

all: simple

%.ufsmo : %.ufsm
	@echo UFSMGEN $< 
	@$(UFSMGENERATE) -v2 c $< .
	@$(CC) $(CFLAGS) -c $(patsubst %.ufsm, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

simple: $(UFSM_MODEL_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_MODEL_OBJS) $(C_OBJS) $(CFLAGS) -o $@


clean:
	@rm -f *.o *.ufsmo
	@rm -f simple
	@$(foreach UFSMGEN,$(UFSM_MODEL), \
		@rm -f $(patsubst %.ufsm, %.[ch], $(UFSMGEN)))

