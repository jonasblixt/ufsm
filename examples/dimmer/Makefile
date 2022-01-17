UFSMGENERATE ?= ufsm-generate

CC ?= gcc

CFLAGS = -Wall -O2 -I ../../ -I .
LDFLAGS = $(shell pkg-config --cflags --libs ufsm-core)

UFSM_MODEL = dimmer.ufsm
UFSM_MODEL_OBJS = $(UFSM_MODEL:.ufsm=.ufsmo)

C_SRCS  = main.c
C_OBJS = $(C_SRCS:.c=.o)

all: main

%.ufsmo : %.ufsm
	@echo UFSMGEN $< 
	@$(UFSMGENERATE) --input $< --output $(patsubst %.ufsm, %, $(<))
	@$(CC) $(CFLAGS) -c $(patsubst %.ufsm, %.c, $(<)) -o $@

%.o : %.c
	@echo CC $<
	@$(CC) $(CFLAGS) -c $< -o $@

main: $(UFSM_MODEL_OBJS) $(C_OBJS)
	@echo LINK $@
	@$(CC) $(UFSM_MODEL_OBJS) $(C_OBJS) $(CFLAGS) $(LDFLAGS) -o $@


clean:
	@rm -f *.o *.ufsmo
	@rm -f dimmer
	@$(foreach UFSMGEN,$(UFSM_MODEL), \
		@rm -f $(patsubst %.ufsm, %.[ch], $(UFSMGEN)))
