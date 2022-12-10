/* Autogenerated with uFSM */

#include "output.h"


unsigned int sq_len(struct ufsm_machine *m)
{
    if (m->head == m->tail)
        return 0;
    if (m->tail < m->head)
        return m->head + 16 - m->tail;
    return m->tail - m->head;
}

unsigned int sq_push(struct ufsm_machine *m, unsigned int signal)
{
    if (sq_len(m) == 16)
        return 1;
    m->signal[m->head++] = signal;
    if (m->head == 16)
        m->head = 0;
    return 0;
}

unsigned int sq_pop(struct ufsm_machine *m)
{
    unsigned int result = m->signal[m->tail++];

    if (m->tail == 16)
        m->tail = 0;

    return result;
}


int ufsm_process(struct ufsm_machine *m, unsigned int event)
{

    for (unsigned int i = 0; i < 7; i++)
        m->wsv[i] = 0;

    switch(event) {
        case UFSM_RESET:
            m->wsv[0] = 1;
            m->wsv[5] = 10;
            m->wsv[6] = 11;
            m->wsv[3] = 7;
            m->wsv[4] = 8;
            m->wsv[1] = 2;
            m->wsv[2] = 3;
            eA(m->user);
            if ((m->wsv[0] == 6)) {
                eD1(m->user);
            }
            if ((m->wsv[5] == 10) && (m->wsv[0] == 6)) {
                eD11(m->user);
            }
            if ((m->wsv[0] == 6)) {
                eE1(m->user);
            }
            if ((m->wsv[3] == 7) && (m->wsv[0] == 6)) {
                eE11(m->user);
            }
            if ((m->wsv[0] == 1)) {
                eC1(m->user);
            }
            if ((m->wsv[1] == 2) && (m->wsv[0] == 1)) {
                eC11(m->user);
            }
        break;
        case e2:
            /* C2 -> Fork */
            if ((m->csv[1] == 5) && (m->csv[0] == 1)) {
                /* Exit actions */
                if ((m->csv[2] == 4) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC12(m->user);
                }
                if ((m->csv[2] == 3) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC11(m->user);
                }
                if ((m->csv[1] == 5) && (m->csv[0] == 1)) {
                    xC2(m->user);
                }
                if ((m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC1(m->user);
                }
                if ((m->csv[0] == 1)) {
                    xA(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[0] = 6;
                eB(m->user);
                if ((m->wsv[0] == 6)) {
                    m->wsv[3] = 7;
                    eE1(m->user);
                }
                if ((m->wsv[0] == 6)) {
                    m->wsv[5] = 10;
                    eD1(m->user);
                }
                if ((m->wsv[5] == 10) && (m->wsv[0] == 6)) {
                    m->wsv[6] = 12;
                    eD12(m->user);
                }
                if ((m->wsv[3] == 7) && (m->wsv[0] == 6)) {
                    m->wsv[4] = 8;
                    eE11(m->user);
                }
            }
        break;
        case e1:
            /* D1 -> C11 */
            if ((m->csv[5] == 10) && (m->csv[0] == 6)) {
                if ((m->csv[6] == 12) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                    if (!((m->csv[4] == 8) && (m->csv[3] == 7) && (m->csv[0] == 6))) {
                        /* Exit actions */
                        if ((m->csv[6] == 12) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                            xD12(m->user);
                        }
                        if ((m->csv[6] == 11) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                            xD11(m->user);
                        }
                        if ((m->csv[4] == 9) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                            xE12(m->user);
                        }
                        if ((m->csv[4] == 8) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                            xE11(m->user);
                        }
                        if ((m->csv[5] == 13) && (m->csv[0] == 6)) {
                            xD2(m->user);
                        }
                        if ((m->csv[5] == 10) && (m->csv[0] == 6)) {
                            xD1(m->user);
                        }
                        if ((m->csv[3] == 7) && (m->csv[0] == 6)) {
                            xE1(m->user);
                        }
                        if ((m->csv[0] == 6)) {
                            xB(m->user);
                        }
                        /* Actions */
                        o1(m->user);
                        if(sq_push(m, 10) != 0)
                            return -UFSM_SIGNAL_QUEUE_FULL;
                        /* Entry actions */
                        m->wsv[0] = 1;
                        eA(m->user);
                        if ((m->wsv[0] == 1)) {
                            m->wsv[1] = 2;
                            eC1(m->user);
                        }
                        if ((m->wsv[1] == 2) && (m->wsv[0] == 1)) {
                            m->wsv[2] = 3;
                            eC11(m->user);
                        }
                    }
                }
            }
        break;
        case e3:
            /* C11 -> C12 */
            if ((m->csv[2] == 3) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                /* Exit actions */
                if ((m->csv[2] == 3) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC11(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[2] = 4;
                eC12(m->user);
            }
            /* C12 -> C11 */
            if ((m->csv[2] == 4) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                /* Exit actions */
                if ((m->csv[2] == 4) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC12(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[2] = 3;
                eC11(m->user);
            }
        break;
        case e4:
            /* C1 -> C2 */
            if ((m->csv[1] == 2) && (m->csv[0] == 1)) {
                /* Exit actions */
                if ((m->csv[2] == 4) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC12(m->user);
                }
                if ((m->csv[2] == 3) && (m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC11(m->user);
                }
                if ((m->csv[1] == 2) && (m->csv[0] == 1)) {
                    xC1(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[1] = 5;
                eC2(m->user);
            }
            /* C2 -> C1 */
            if ((m->csv[1] == 5) && (m->csv[0] == 1)) {
                /* Exit actions */
                if ((m->csv[1] == 5) && (m->csv[0] == 1)) {
                    xC2(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[1] = 2;
                eC1(m->user);
                if ((m->wsv[1] == 2)) {
                    m->wsv[2] = 3;
                    eC11(m->user);
                }
            }
        break;
        case e5:
            /* D1 -> D2 */
            if ((m->csv[5] == 10) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[6] == 12) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                    xD12(m->user);
                }
                if ((m->csv[6] == 11) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                    xD11(m->user);
                }
                if ((m->csv[5] == 10) && (m->csv[0] == 6)) {
                    xD1(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[5] = 13;
                eD2(m->user);
            }
            /* D2 -> D1 */
            if ((m->csv[5] == 13) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[5] == 13) && (m->csv[0] == 6)) {
                    xD2(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[5] = 10;
                eD1(m->user);
                if ((m->wsv[5] == 10)) {
                    m->wsv[6] = 11;
                    eD11(m->user);
                }
            }
        break;
        case e6:
            /* D11 -> D12 */
            if ((m->csv[6] == 11) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[6] == 11) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                    xD11(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[6] = 12;
                eD12(m->user);
            }
            /* D12 -> D11 */
            if ((m->csv[6] == 12) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[6] == 12) && (m->csv[5] == 10) && (m->csv[0] == 6)) {
                    xD12(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[6] = 11;
                eD11(m->user);
            }
        break;
        case e7:
            /* E11 -> E12 */
            if ((m->csv[4] == 8) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[4] == 8) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                    xE11(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[4] = 9;
                eE12(m->user);
            }
            /* E12 -> E11 */
            if ((m->csv[4] == 9) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                /* Exit actions */
                if ((m->csv[4] == 9) && (m->csv[3] == 7) && (m->csv[0] == 6)) {
                    xE12(m->user);
                }
                /* Actions */
                /* Entry actions */
                m->wsv[4] = 8;
                eE11(m->user);
            }
        break;
        default:
            return -UFSM_BAD_ARGUMENT;
    }
    for (unsigned int i = 0; i < 7; i++)
        if(m->wsv[i] != 0)
            m->csv[i] = m->wsv[i];


    while(sq_len(m) > 0) {
        for (unsigned int i = 0; i < 7; i++)
            m->wsv[i] = 0;

        switch(sq_pop(m)) {
            case s1:
                /* A -> B */
                if ((m->csv[0] == 1)) {
                    if (!((m->csv[1] == 5) && (m->csv[0] == 1))) {
                        /* Exit actions */
                        if ((m->csv[2] == 4) && (m->csv[1] == 2)) {
                            xC12(m->user);
                        }
                        if ((m->csv[2] == 3) && (m->csv[1] == 2)) {
                            xC11(m->user);
                        }
                        if ((m->csv[1] == 5)) {
                            xC2(m->user);
                        }
                        if ((m->csv[1] == 2)) {
                            xC1(m->user);
                        }
                        xA(m->user);
                        /* Actions */
                        o2(m->user);
                        /* Entry actions */
                        m->wsv[0] = 6;
                        eB(m->user);
                        if ((m->wsv[0] == 6)) {
                            m->wsv[3] = 7;
                            eE1(m->user);
                        }
                        if ((m->wsv[0] == 6)) {
                            if (m->csv[5] == 10) {
                                m->wsv[5] = 10;
                                eD1(m->user);
                            }
                        }
                        if ((m->wsv[0] == 6)) {
                            if (m->csv[5] == 13) {
                                m->wsv[5] = 13;
                                eD2(m->user);
                            }
                        }
                        if ((m->wsv[5] == 10) && (m->wsv[0] == 6)) {
                            m->wsv[6] = 11;
                            eD11(m->user);
                        }
                        if ((m->wsv[3] == 7) && (m->wsv[0] == 6)) {
                            m->wsv[4] = 8;
                            eE11(m->user);
                        }
                    }
                }
            break;
            default:
                return -UFSM_BAD_ARGUMENT;
        }
        for (unsigned int i = 0; i < 7; i++)
            if(m->wsv[i] != 0)
                m->csv[i] = m->wsv[i];
    }
}