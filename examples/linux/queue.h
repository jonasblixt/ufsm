#ifndef UFSM_QUEUE_H
#define UFSM_QUEUE_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <pthread.h>
#include <sys/epoll.h>

enum ufsm_queue_status
{
    UFSM_ERROR_QUEUE_EVENT,
    UFSM_ERROR_QUEUE_LOCK,
    UFSM_ERROR_QUEUE_EMPTY,
    UFSM_ERROR_QUEUE_FULL,
};

struct ufsm_queue
{
    size_t no_of_elements;
    size_t size;
    int head;
    int tail;
    int event_fd;
    int epoll_fd;
    pthread_mutex_t lock;
    struct epoll_event ev;
    int data[];
};

struct ufsm_queue * ufsm_queue_init(int epoll_fd, size_t size);
void ufsm_queue_free(struct ufsm_queue *q);
int ufsm_queue_pop(struct ufsm_queue *q);
int ufsm_queue_push(struct ufsm_queue *q, int ev);
int ufsm_queue_get_fd(struct ufsm_queue *q);
int ufsm_queue_handle(struct ufsm_queue *q, uint64_t *events);

#endif
