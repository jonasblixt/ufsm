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
            rule.wsv_states = parent_states.copy()

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
        # We only care about normal states and final states
        if isinstance(s, State):
            parent_states = find_parent_states(s)

            rule = Rule()
            rule.wsv_states = parent_states.copy()

            entry_rule = EntryRule(rule)
            entry_rule.targets.append(s)
            entry_rule.actions = s.entries.copy()
            entry_rules[s_id] = entry_rule

            rule = Rule()
            rule.csv_states = [s] + parent_states.copy()

            exit_rule = ExitRule(rule, s)
            exit_rule.actions = s.exits.copy()

            exit_rules[s_id] = exit_rule
        elif isinstance(s, Final):
            parent_states = find_parent_states(s)

            rule = Rule()
            rule.wsv_states = parent_states.copy()

            entry_rule = EntryRule(rule)
            entry_rule.targets.append(s)
            entry_rules[s_id] = entry_rule

            rule = Rule()
            rule.csv_states = [s] + parent_states.copy()

            exit_rule = ExitRule(rule, s)

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

        if isinstance(current_state, Final):
            continue

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
                        entry_rule = copy.deepcopy(fmodel.entry_rules[init_trans.dest.id])
                        entry_rule.actions = init_trans.actions + entry_rule.actions
                        result.append(entry_rule)
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
            for s in r.rule.wsv_states:
                if s.id == nca_state.id:
                    found_nca = True
                    break
            if found_nca:
                while True:
                    popped = r.rule.wsv_states.pop()
                    logger.debug(f"{popped}")
                    if popped.id == nca_state.id:
                        break
    return result


def _build_join(hmodel: Model, fmodel: FlatModel, t: Transition):
    ft = FlatTransition(t.trigger, t.source, t.dest)
    # Find all source states
    # LCA (Source states, target state)
    logger.debug("Join source states: ")
    source_states = []

    for tran in hmodel.transitions:
        if tran.dest.id == t.source.id:
            logger.debug(f"{tran.source}")
            source_states.append(tran.source)

    state_conditions = []
    guards = []

    for s in source_states:
        rule = Rule()
        rule.csv_states = [s] + find_parent_states(s)
        state_conditions.append(rule)

    ft.rules = state_conditions

    # TODO: Break out in separate function
    for guard in t.guards:
        if isinstance(guard, GuardPState):
            rule = Rule()
            rule.csv_states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardNState):
            rule = Rule()
            rule.invert = True
            rule.csv_states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardFunction):
            guards.append(guard)

    ft.guards = guards

    # Compute states to exit
    exit_rules = []

    nca = nearest_common_ancestor(source_states[0], t.dest)
    top_state_to_exit = find_ancestor_state(source_states[0], nca)

    if top_state_to_exit:
        for s in descendant_states(top_state_to_exit):
            exit_rules.append(copy.deepcopy(fmodel.exit_rules[s.id]))
    else:
        exit_rules.append(copy.deepcopy(fmodel.exit_rules[source_states[0].id]))

    ft.exits = exit_rules
    top_state_to_enter = find_ancestor_state(t.dest, nca)
    entry_rules = _transition_enter(
        hmodel, fmodel, top_state_to_enter, t.dest, nca
    )

    ft.entries = entry_rules

    ft.actions = t.actions
    return ft

def _compute_completion_event(hmodel: Model, fmodel: FlatModel, t: Transition):
    """ Completion-event algorithm:

        't'                     Transition
        'ct'                    Completion transition
        'exit_exclution_list'   List of states that must be excluded when
                                computing the exit scope of a state

        0) source = t.source, append t.source to the 'exit_exclusion_list'
        1) We transition into a final state 'Final'
        2) Check if the parent state to 'Final' has a 'completion-event' transition.
            if it does, we continue with 'ct'
        3) If '2' is satisfied the 'ct' is executed
            3a) Exit(ct.source, exit_exclution_list)
            3b) Run 
            3c) Append 'ct.source' on the 'exit_exclusion_list'
        4) If ct.dest is another Final state: source = ct.source,
            goto 1
    """

    source = t.source # Source state that triggered a 'completion' transition
    dest = t.dest     # Current destination state
    exit_exclusion_list = [source.id]
    exit_rules = []
    entry_rules = []

    logging.debug(f"Searching from completion transitions to {dest.parent}.{dest}")

    # Begining with the input transition 't' which has a 'Final' destination state
    # we try to resolve all completion-events
    while ct := find_completion_transition_from_final(dest):
        logging.debug(f"Completion transition {ct.source} -> {ct.dest}")

        nca = nearest_common_ancestor(source, ct.dest)
        top_state_to_exit = find_ancestor_state(source, nca)
        orth_finals = find_orth_finals(source)         # Final states in orthogonal regions
        orth_regions = [s.parent for s in orth_finals] # List of parent regions of final states

        logger.debug(f"Found {len(orth_finals)} orthogonal final's")

        if top_state_to_exit:
            for s in descendant_states(top_state_to_exit):
                if s.id in exit_exclusion_list:
                    continue
                # If state 's' is in a region with a final state we should not
                # add an exit rule, since that final state will be a condition
                # to the current 'ct'
                if s.parent in orth_regions:
                    continue
                new_rule = copy.deepcopy(fmodel.exit_rules[s.id])
                new_rule.rule.csv_states = orth_finals + new_rule.rule.csv_states
                exit_rules.append(new_rule)
        else:
            exit_rules.append(copy.deepcopy(fmodel.exit_rules[source.id]))

        exit_exclusion_list.append(ct.source.id)

        for xr in exit_rules:
            logging.debug(f"{xr}")

        top_state_to_enter = find_ancestor_state(ct.dest, nca)
        entry_rules += _transition_enter(
            hmodel, fmodel, top_state_to_enter, ct.dest, nca
        )

        for er in entry_rules:
            er.rule.csv_states = orth_finals + er.rule.csv_states

        dest = ct.dest
        source = ct.source

    return exit_rules, entry_rules

def _build_one_transition_schedule(hmodel: Model, fmodel: FlatModel, input_transition: Transition):
    t = input_transition
    logging.debug(f"Transition {t.trigger} {t.source} -> {t.dest}")
    ft = FlatTransition(t.trigger, t.source, t.dest)
    explicit_target_states = []

    if isinstance(t.dest, State) or isinstance(t.dest, Final):
        explicit_target_states = [t.dest]
    elif isinstance(t.dest, Fork):
        explicit_target_states = find_target_states_from_fork(t.dest)
    elif isinstance(t.dest, Join):
        # Do nothing, joins are evaluated on out-bound transitions
        return
    else:
        logger.error("Don't know what to do")
        return
        #raise Exception()

    if isinstance(t.source, Join):
        return _build_join(hmodel, fmodel, t)

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
    guards = []

    rule = Rule()
    rule.csv_states = [t.source] + find_parent_states(t.source)
    state_conditions.append(rule)

    for guard in t.guards:
        if isinstance(guard, GuardPState):
            rule = Rule()
            rule.csv_states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardNState):
            rule = Rule()
            rule.invert = True
            rule.csv_states = [guard.state] + find_parent_states(guard.state)
            state_conditions.append(rule)
        if isinstance(guard, GuardFunction):
            guards.append(guard)

    ft.rules = state_conditions
    ft.guards = guards

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

    # If the destination state is a 'Final' state we shall try to statically
    #  compute 'completion-events'
    if isinstance(t.dest, Final):
        completion_exits, completion_entries = _compute_completion_event(hmodel, fmodel, t)

        ft.entries += completion_entries
        ft.exits += completion_exits

    return ft


def _build_transition_schedule(hmodel: Model, fmodel: FlatModel):
    result = []
    for s_id, s in hmodel.states.items():
        if not (isinstance(s, State) or isinstance(s, Join)):
            continue
        for t in s.transitions:
            # Ignore 'completion-event' triggers
            if isinstance(t.trigger, CompletionTrigger):
                continue
            schedule = _build_one_transition_schedule(hmodel, fmodel, t)
            if schedule is not None:
                result.append(schedule)
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
