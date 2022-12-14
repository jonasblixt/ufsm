import logging
import uuid
import copy
from .flat_model import *
from .model import *
from .model_utils import *

logger = logging.getLogger(__name__)

def _merge_rules(t: FlatTransition):
    logger.debug(f"{t}")
    entries_to_check = copy.copy(t.entries)

    while len(entries_to_check) > 0:
        e = entries_to_check.pop()

        for e1 in t.entries:
            if e1 == e:
                continue

            if e.rule == e1.rule:
                logger.debug(f"Merge {e} {e1}")

def _reduce_entry_conditions(t: FlatTransition):
    pass

def _simple_reduce_exits(t: FlatTransition):
    logger.debug(f"simple_reduce: {t}")
    state_invariants = []

    for r in t.rules:
        if r.invert == False:
            for s in r.states:
                state_invariants.append(s)

    for s in state_invariants:
        logger.debug(f"{s}")
        for x in t.exits:
            for ss in x.rule.states:
                if ss.id == s.id:
                    x.rule.states.remove(ss)

    logger.debug(f"result: {t}")

def optimizer(fmodel: FlatModel) -> FlatModel:
    logger.debug("Optimizing...")

    #for t in fmodel.transition_schedule:
    #    _reduce_entry_conditions(t)

    #_merge_rules(fmodel.transitions_schedule[0])
    _simple_reduce_exits(fmodel.transition_schedule[0])

    return fmodel
