from .model import *


def find_parent_states(state: State) -> [State]:
    """Find all parent states of state 'state'"""
    result = []
    s = state
    while s != None:
        pr = s.parent
        s = pr.parent

        if s != None:
            result.append(s)
    return result


def nearest_common_ancestor(s1: State, s2: State):
    """Compute the nearest common anscestor region between states 's1' and 's2'"""
    nca = s1.parent
    nca2 = s2.parent

    while nca != None:
        nca2 = s2.parent
        while True:
            if nca == nca2:
                return nca
            if nca2.parent == None:
                break
            nca2 = nca2.parent.parent
            if nca2 == None:
                break
        nca = nca.parent.parent
    return None


def _descendant_states_inner(region, depth):
    result = {}
    depth = depth + 1
    for s in region.states:
        if not isinstance(s, State):
            continue
        if depth not in result:
            result[depth] = []
        result[depth].append(s)

        for r in s.regions:
            result_inner = _descendant_states_inner(r, depth)
            for k in result_inner:
                if k not in result:
                    result[k] = []

                for s in result_inner[k]:
                    result[k].append(s)
    return result


def descendant_states(state):
    """Depth first search for an descendat states to 'state'"""
    result = {}
    depth = 1
    for r in state.regions:
        result_inner = _descendant_states_inner(r, depth)
        for k in result_inner:
            if k not in result:
                result[k] = []
            for s in result_inner[k]:
                result[k].append(s)
    output = []
    if result is not None:
        depths = list(result.keys())
        depths.sort()
        for k in depths:
            for s in result[k]:
                output.append(s)
    output.reverse()
    output.append(state)
    return output


def is_descendant(parent: State, child: State):
    """Check if 'child' state is a descendant of 'parent' state"""
    states = descendant_states(parent)
    return child in states


def find_ancestor_state(child: State, ancestor_region: Region):
    """Find, if it exists, an ancestor state to 'child' in
    'ancestor_region'"""

    pr = child.parent
    if pr == ancestor_region:
        return child

    while (pr != None) and (pr != ancestor_region):
        ps = pr.parent

        if ps == None:
            break

        if ps.parent == ancestor_region:
            return ps
        pr = ps.parent

    return None


def find_init_transition_in_region(region: Region):
    for s in region.states:
        if isinstance(s, Init) or isinstance(s, ShallowHistory):
            transition = s.transitions[0]
            return transition
    return None


def find_target_states_from_fork(fork_state: Fork):
    result = []
    if not isinstance(fork_state, Fork):
        return result
    for t in fork_state.transitions:
        result.append(t.dest)
    return result
