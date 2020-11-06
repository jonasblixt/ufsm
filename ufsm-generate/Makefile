TARGET = ufsmimport
PREFIX ?= /usr
CC ?= gcc

LDFLAGS = $(shell pkg-config --libs sotc json-c uuid)
CFLAGS  = -Wall -std=c99
CFLAGS += -I.. -I. $(shell pkg-config sotc --cflags sotc json-c uuid)

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
