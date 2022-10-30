import logging
import uuid
import copy
from .flat_model import *
from .model import *
from .model_utils import *

logger = logging.getLogger(__name__)

# TODO: Data format
def _initial_state_vector(hmodel: Model):
    isv = []
    for s_id, s in hmodel.states.items():
        if isinstance(s, Init) or isinstance(s, ShallowHistory):
            t = s.transitions[0]
            isv.append(t.dest)
    output_string = ", ".join(str(s) for s in isv)
    logger.debug(f"Initial state vector: s0 = {output_string}")


# TODO: Data format
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

        entry_rule = EntryRule(rule, s)
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
                rule.rule.states.insert(0, s)
                rules.append(rule)
            history_rules[history_state.id] = rules

    return history_rules


def _transition_enter(
    hmodel: Model,
    fmodel: FlatModel,
    top_state: State,
    explicit_target_states: List[State],
) -> List[EntryRule]:
    result = []
    state_stack = [top_state]

    # Add the top state to entry rules list
    result.append(fmodel.entry_rules[top_state.id])

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
                result.append(fmodel.entry_rules[ancestor_state.id])
            else:
                # Normal init, find init/history state in region
                init_trans = find_init_transition_in_region(r)

                if isinstance(init_trans.source, Init):
                    logging.debug(f"Normal init for region: {r} {init_trans.dest}")
                    result.append(fmodel.entry_rules[init_trans.dest.id])
                elif isinstance(init_trans.source, ShallowHistory):
                    logging.debug(f"History init for region: {r}")
                    result += fmodel.history_rules[init_trans.source.id]

            for s in r.states:
                if isinstance(s, State):
                    state_stack.append(s)

    return result


def _build_one_transition_schedule(hmodel: Model, fmodel: FlatModel, t: Transition):
    explicit_target_states = []

    logger.debug("")
    logger.debug(f"{t.trigger} {t.source} → {t.dest} id: {t.id}")

    if isinstance(t.dest, State):
        explicit_target_states = [t.dest]
    elif isinstance(t.dest, Fork):
        explicit_target_states = find_target_states_from_fork(t.dest)
    else:
        logger.error("Don't know what to do")
        raise Exception()

    logger.debug(
        f"Explicit target states: " + ", ".join(str(s) for s in explicit_target_states)
    )

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

    logger.debug(f"NCA: {nca}")

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

    logger.debug(f"State conditions:")

    for r in state_conditions:
        logger.debug(f"    {r}")

    if len(guard_functions) > 0:
        logger.debug(f"Guard functions to call:")

        for g in guard_functions:
            logger.debug(f"    {g}")

    # Compute states to exit
    exit_rules = []
    top_state_to_exit = find_ancestor_state(t.source, nca)
    logger.debug(f"Top state to exit: {top_state_to_exit}")

    if top_state_to_exit:
        for s in descendant_states(top_state_to_exit):
            exit_rules.append(fmodel.exit_rules[s.id])
    else:
        exit_rules.append(fmodel.exit_rules[t.source.id])

    logger.debug(f"Exit rules to run:")
    for r in exit_rules:
        logger.debug("    " + str(r))

    # Call transition actions
    logger.debug(f"Actions to run")

    for action in t.actions:
        logger.debug(f"    {action}")

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

    logger.debug(f"Top state to enter: {top_state_to_enter}")

    entry_rules = _transition_enter(
        hmodel, fmodel, top_state_to_enter, explicit_target_states
    )

    logger.debug(f"Entry rules to run:")

    for r in entry_rules:
        logger.debug("    " + str(r))


def _build_transition_schedule(hmodel: Model, fmodel: FlatModel):
    for s_id, s in hmodel.states.items():
        if not isinstance(s, State):
            continue
        for t in s.transitions:
            if (
                t.id != uuid.UUID("3077f730-a639-4c24-b3d5-fa6f57daeac9")
                and t.id != uuid.UUID("e65a1b52-9eae-4cba-9ace-f546b77d2f97")
                and t.id != uuid.UUID("585b1e55-bbff-4456-9bec-ad1c0ff65e8d")
            ):
                continue
            _build_one_transition_schedule(hmodel, fmodel, t)
    return {}


def flatten_model(hmodel: Model) -> FlatModel:
    logger.debug(f"Flattening {hmodel.name}")
    fmodel = FlatModel()

    _initial_state_vector(hmodel)
    _build_state_group(hmodel)

    entry_rules, exit_rules = _build_entry_exit_rules(hmodel)
    fmodel.entry_rules = entry_rules
    fmodel.exit_rules = exit_rules

    history_rules = _build_history_rules(hmodel, fmodel)

    fmodel.history_rules = history_rules

    logger.debug("Entry rules:")
    for s_id, r in entry_rules.items():
        logger.debug(f"en({r.target}): {r}")

    logger.debug("Exit rules:")
    for s_id, r in exit_rules.items():
        logger.debug(f"ex({r.state}): {r}")

    logger.debug("History rules:")
    for s_id, rules in history_rules.items():
        for r in rules:
            logger.debug(f"hi({r.target}): {r}")

    transition_schedule = _build_transition_schedule(hmodel, fmodel)
