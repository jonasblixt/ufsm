TARGET = ufsmimport
PREFIX ?= /usr
CC ?= gcc

LDFLAGS = $(shell xml2-config --libs)
CFLAGS  = -Wall -std=c99
CFLAGS += -I.. -I. $(shell xml2-config --cflags)

C_SRCS  = ufsmimport.c output.c

OBJS = $(C_SRCS:.c=.o)

all: $(TARGET)

%.o : %.c
	@echo CC $<
	@$(CC) -c $(CFLAGS) $< -o $@

$(TARGET): $(OBJS)
	@echo LINK $@
	@$(CC) $(OBJS) $(CFLAGS) $(LDFLAGS) -o $@

install:
	@install -m 755 $(TARGET) $(PREFIX)/bin	

clean:
	@rm -f $(TARGET)
	@rm -f *.o
