#include <stdio.h>
#include "output.h"

void eA(void *user)
{
    printf("eA\n");
}

void xA(void *user)
{
    printf("xA\n");
}

void eC1(void *user)
{
    printf("eC1\n");
}

void xC1(void *user)
{
    printf("xC1\n");
}

void eC11(void *user)
{
    printf("eC11\n");
}

void xC11(void *user)
{
    printf("xC11\n");
}

void eC12(void *user)
{
    printf("eC12\n");
}

void xC12(void *user)
{
    printf("xC12\n");
}

void eB(void *user)
{
    printf("eB\n");
}

void xB(void *user)
{
    printf("xB\n");
}

void eC2(void *user)
{
    printf("eC2\n");
}

void xC2(void *user)
{
    printf("xC2\n");
}

void eD2(void *user)
{
    printf("eD2\n");
}

void xD2(void *user)
{
    printf("xD2\n");
}

void eD1(void *user)
{
    printf("eD1\n");
}

void xD1(void *user)
{
    printf("xD1\n");
}

void eD11(void *user)
{
    printf("eD11\n");
}

void xD11(void *user)
{
    printf("xD11\n");
}

void eD12(void *user)
{
    printf("eD12\n");
}

void xD12(void *user)
{
    printf("xD12\n");
}

void eE1(void *user)
{
    printf("eE1\n");
}

void xE1(void *user)
{
    printf("xE1\n");
}

void eE11(void *user)
{
    printf("eE11\n");
}

void xE11(void *user)
{
    printf("xE11\n");
}

void eE12(void *user)
{
    printf("eE12\n");
}

void xE12(void *user)
{
    printf("xE12\n");
}

void o2(void *user)
{
    printf("o2\n");
}

void o1(void *user)
{
    printf("o1\n");
}

int main(int argc, char **argv)
{
    struct ufsm_machine m = {0};
    printf("RESET\n");
    ufsm_process(&m, UFSM_RESET);
    printf("Reset done\n");
    printf("-> e4\n");
    ufsm_process(&m, e4);
    printf("-> e2\n");
    ufsm_process(&m, e2);
    printf("-> e1\n");
    ufsm_process(&m, e1);

    printf("-> e7\n");
    ufsm_process(&m, e7);

    printf("-> e1\n");
    ufsm_process(&m, e1);
}
