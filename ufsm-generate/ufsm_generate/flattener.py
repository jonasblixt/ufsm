import logging
import uuid
import copy
from .flat_model import *
from .model import *
from .model_utils import *

logger = logging.getLogger(__name__)

def _initial_state_vector(hmodel: Model):
    isv = []
    logger.debug("Entry rules:")
    for s_id, s in hmodel.states.items():
        if isinstance(s, Init) or isinstance(s, ShallowHistory):
            t = s.transitions[0]

            parent_states = find_parent_states(t.dest)

            rule = Rule()
            rule.states = parent_states.copy()

            entry_rule = EntryRule(rule)
            entry_rule.targets.append(t.dest)
            entry_rule.actions = t.actions.copy()
            logger.debug(f"{entry_rule}")

            isv.append(entry_rule)

    isv.reverse()
    return isv


def _build_state_group(hmodel):
    state_groups = {}
    for r_id, region in hmodel.regions.items():
        states = []
        for s in region.states:
            if isinstance(s, State):
                states.append(s)
        state_groups[region.id] = states

    output_string = ""
    for group_name in state_groups.keys():
        output_string += "{"
        output_string = output_string + ", ".join(
            s.name for s in state_groups[group_name]
        )

        output_string += "}, "
    logger.debug("M = " + output_string)


def _build_entry_exit_rules(hmodel: Model):
    entry_rules = {}
    exit_rules = {}

    logger.debug("Building entry and exit rules")
    for s_id, s in hmodel.states.items():
        # We only care about normal states
        if not isinstance(s, State):
            continue

        parent_states = find_parent_states(s)

        rule = Rule()
        rule.states = parent_states.copy()

        entry_rule = EntryRule(rule)
        entry_rule.targets.append(s)
        entry_rule.actions = s.entries.copy()
        entry_rules[s_id] = entry_rule

        rule = Rule()
        rule.states = [s] + parent_states.copy()

        exit_rule = ExitRule(rule, s)
        exit_rule.actions = s.exits.copy()

        exit_rules[s_id] = exit_rule

    return (entry_rules, exit_rules)


def _build_history_rules(hmodel: Model, fmodel: FlatModel):
    history_rules = {}

    logger.debug("Building history rules")
    for r_id, r in hmodel.regions.items():
        history_state = None

        for s in r.states:
            if isinstance(s, ShallowHistory):
                history_state = s
                break

        if history_state != None:
            rules = []
            for s in r.states:
                if not isinstance(s, State):
                    continue
                logger.debug(f"{s}")
                rule = copy.deepcopy(fmodel.entry_rules[s.id])
                rule.rule.history = True
                #rule.rule.states.insert(0, s)
                rules.append(rule)
            history_rules[history_state.id] = rules

    return history_rules


def _transition_enter(
    hmodel: Model,
    fmodel: FlatModel,
    top_state: State,
    explicit_target_states: List[State],
    nca: State,
) -> List[EntryRule]:
    result = []
    state_stack = [top_state]

    # Add the top state to entry rules list
    result.append(copy.deepcopy(fmodel.entry_rules[top_state.id]))

    while len(state_stack) > 0:
        current_state = state_stack.pop()

        for r in current_state.regions:
            ancestor_state = None
            # Try to find ancestor to explicit target states in this region
            for ets in explicit_target_states:
                ancestor_state = find_ancestor_state(ets, r)
                if ancestor_state != None:
                    break

            if ancestor_state != None:
                # Found ancestor, we should not go through init/history states
                logging.debug(f"Found ancestor {ancestor_state.name} in region {r}")
                result.append(copy.deepcopy(fmodel.entry_rules[ancestor_state.id]))
            else:
                # Normal init, find init/history state in region
                init_trans = find_init_transition_in_region(r)
                if init_trans is not None:
                    if isinstance(init_trans.source, Init):
                        logging.debug(f"Normal init for region: {r} {init_trans.dest}")
                        result.append(copy.deepcopy(fmodel.entry_rules[init_trans.dest.id]))
                    elif isinstance(init_trans.source, ShallowHistory):
                        logging.debug(f"History init for region: {r}")
                        result += copy.deepcopy(fmodel.history_rules[init_trans.source.id])
                else:
                    logger.debug(f"WARNING found no initalizer in region {r}")

            for s in r.states:
                if isinstance(s, State):
                    state_stack.append(s)

    # If NCA is found in the rules, we should delete rules up until and including
    # NCA
    if nca.parent:
        logger.debug(f"NCA: {nca.parent}")
        nca_state = nca.parent
        for r in result:
            found_nca = False
            for s in r.rule.states:
                if s.id == nca_state.id:
                    found_nca = True
                    break
            if found_nca:
                while True:
                    popped = r.rule.states.pop()
                    logger.debug(f"{popped}")
                    if popped.id == nca_state.id:
                        break
    return result


def _build_one_transition_schedule(hmodel: Model, fmodel: FlatModel, t: Transition):
    ft = FlatTransition(t.trigger, t.source, t.dest)
    explicit_target_states = []

    logging.debug(f"Transition {t.source} -> {t.dest}")
    if isinstance(t.dest, State):
        explicit_target_states = [t.dest]
    elif isinstance(t.dest, Fork):
        explicit_target_states = find_target_states_from_fork(t.dest)
    else:
        logger.error("Don't know what to do")
        return
        #raise Exception()

    # Compute nearest common ancestor region and check that the nca is the same
    #  when we have multiple explicit target states.
    nca = None

    for ts in explicit_target_states:
        if nca is None:
            nca = nearest_common_ancestor(t.source, ts)
        else:
            # TODO: Raise exception in stead of assert
            #  InconsistentNCAException
            assert nearest_common_ancestor(t.source, ts) == nca

    # Compute state conditions (Source state + guard states) and guard functions
    state_conditions = []
    guard_functions = []

    rule = Rule()
    rule.states = [t.source] + find_parent_states(t.source)
    state_conditions.append(rule)

    for guard in t.guards:
        if isinstance(guard, GuardPState):
            rule = Rule()
            rule.states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardNState):
            rule = Rule()
            rule.invert = True
            rule.states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardFunction):
            guard_functions.append(guard.guard)

    ft.rules = state_conditions
    ft.guard_funcs = guard_functions

    # Compute states to exit
    exit_rules = []
    top_state_to_exit = find_ancestor_state(t.source, nca)

    if top_state_to_exit:
        for s in descendant_states(top_state_to_exit):
            exit_rules.append(copy.deepcopy(fmodel.exit_rules[s.id]))
    else:
        exit_rules.append(copy.deepcopy(fmodel.exit_rules[t.source.id]))

    ft.exits = exit_rules

    ft.actions = t.actions

    # Compute states to enter

    # Compute top state to enter and check that all explicit target states
    #  share the same top state
    top_state_to_enter = None
    for ts in explicit_target_states:
        if top_state_to_enter is None:
            top_state_to_enter = find_ancestor_state(ts, nca)
        else:
            # TODO: Don't assert, throw InconsistentTopState?
            assert find_ancestor_state(ts, nca) == top_state_to_enter

    entry_rules = _transition_enter(
        hmodel, fmodel, top_state_to_enter, explicit_target_states, nca
    )

    ft.entries = entry_rules
    return ft


def _build_transition_schedule(hmodel: Model, fmodel: FlatModel):
    result = []
    for s_id, s in hmodel.states.items():
        if not isinstance(s, State):
            continue
        for t in s.transitions:
            result.append(_build_one_transition_schedule(hmodel, fmodel, t))
    return result


def flatten_model(hmodel: Model) -> FlatModel:
    logger.debug(f"Flattening {hmodel.name}")
    fmodel = FlatModel()

    isv = _initial_state_vector(hmodel)
    fmodel.isv = isv
    _build_state_group(hmodel)

    entry_rules, exit_rules = _build_entry_exit_rules(hmodel)
    fmodel.entry_rules = entry_rules
    fmodel.exit_rules = exit_rules

    history_rules = _build_history_rules(hmodel, fmodel)

    fmodel.history_rules = history_rules

    transition_schedule = _build_transition_schedule(hmodel, fmodel)

    for t in transition_schedule:
        logger.debug(f"\n{t}")

    fmodel.transition_schedule = transition_schedule

    return fmodel
