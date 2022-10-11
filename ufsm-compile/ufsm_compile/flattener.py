import logging
from .flat_model import *
from .model import *

logger = logging.getLogger(__name__)


class Flattener:
    def __init__(self):
        self.regions = []
        self.state_groups = {}
        self.initial_configuration = []
        self.events = []
        self.signals = []
        self.states = {}
        self.exit_rules = {}
        self.entry_rules = {}

    def build_state_group(self, hmodel):
        logger.debug("Building state groups")
        for region in hmodel.regions:
            states = []
            for s in region.states:
                if isinstance(s, State):
                    states.append(s)
            self.state_groups[region.id] = states

            output_string = ""
            for group_name in self.state_groups.keys():
                output_string += "{"
                output_string = output_string + ", ".join(
                    s.name for s in self.state_groups[group_name]
                )

                output_string += "}, "
        logger.debug("M = " + output_string)

    def build_initial_configuration(self, hmodel):
        logger.debug("Building initial configuration")
        for region in hmodel.regions:
            for s in region.states:
                if (
                    isinstance(s, Init)
                    or isinstance(s, ShallowHistory)
                    or isinstance(s, DeepHistory)
                ):
                    t = s.transitions[0]
                    # logger.debug(f'Region {region.name} -> {t.dest.name}')
                    self.initial_configuration.append(t.dest)
        output_string = ", ".join(s.name for s in self.initial_configuration)
        logger.debug(f"s0 = {output_string}")

    def parent_states(self, state):
        result = []
        s = state
        while s != None:
            pr = s.parent_region
            s = pr.parent_state

            if s != None:
                result.append(s)
        return result

    def build_entry_exit_rules(self):
        logger.debug("Building entry and exit rules")
        for s_id in self.states.keys():
            s = self.states[s_id]
            parent_states = self.parent_states(s)
            rule = Rule()
            rule.add_state_conditions(s, parent_states)
            rule.add_actions(s.exits)
            logger.debug("x: " + str(rule))
            self.exit_rules[s_id] = rule

            rule = Rule()
            rule.add_state_conditions(None, parent_states)
            rule.add_actions(s.entries)
            logger.debug("e: " + str(rule))
            self.entry_rules[s_id] = rule

    def nca(self, s1, s2):
        """Compute the nearest common anscestor region between 's1' and 's2'"""
        lca = s1.parent_region
        lca2 = s2.parent_region

        while lca != None:
            lca2 = s2.parent_region
            while True:
                if lca == lca2:
                    return lca
                if lca2.parent_state == None:
                    break
                lca2 = lca2.parent_state.parent_region
                if lca2 == None:
                    break
            lca = lca.parent_state.parent_region
        return None

    def descendant_states_inner(self, region, depth):
        result = {}
        depth = depth + 1
        for s in region.states:
            if not isinstance(s, State):
                continue
            if depth not in result:
                result[depth] = []
            result[depth].append(s)

            for r in s.regions:
                result_inner = self.descendant_states_inner(r, depth)
                for k in result_inner:
                    if k not in result:
                        result[k] = []

                    for s in result_inner[k]:
                        result[k].append(s)
        return result

    def descendant_states(self, state):
        """Depth first search for al descendat states to 'state'"""
        result = {}
        depth = 1
        for r in state.regions:
            result_inner = self.descendant_states_inner(r, depth)
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

    def is_descendant(self, top_state, possible_child_state):
        states = self.descendant_states(top_state)
        return possible_child_state in states

    def transition_exit_rules(self, state, nca):
        ancestor_state = self.find_ancestor_state(state, nca)

        if ancestor_state:
            logger.debug(f"Ancestor state {ancestor_state.name}")
            states_to_exit = self.descendant_states(ancestor_state)
        else:
            states_to_exit = [state]

        logger.debug(f"Exit rules to run:")
        for s_exit in states_to_exit:
            logger.debug(s_exit.name)

    def find_ancestor_state(self, child, ancestor_region):
        """Find, if it exists, and ancestor to 'child' in
        'ancestor_region'"""

        pr = child.parent_region

        if pr == ancestor_region:
            return None
        while (pr != None) and (pr != ancestor_region):
            ps = pr.parent_state
            if ps.parent_region == ancestor_region:
                return ps
            pr = ps.parent_region

    def find_init_state_in_region(self, region):
        for s in region.states:
            if isinstance(s, Init):
                transition = s.transitions[0]
                return transition.dest
            elif isinstance(s, ShallowHistory):
                # TODO: This is not correct
                transition = s.transitions[0]
                return transition.dest
        return None

    def build_entry_rules_for_region(self, region, explicit_target_regions):
        if region.id in explicit_target_regions.keys():
            return self.build_entry_rules(
                [explicit_target_regions[region.id]], explicit_target_regions
            )
        else:
            init_state = self.find_init_state_in_region(region)
            if init_state is not None:
                return self.build_entry_rules([init_state], explicit_target_regions)
        return None

    def build_entry_rules(self, target_states, explicit_target_regions):
        result_states = []

        for s in target_states:
            result_states.append(s)
            for r in s.regions:
                result_states += self.build_entry_rules_for_region(
                    r, explicit_target_regions
                )
        return result_states

    def transition_entry_rules(self, target_states, nca):
        logger.debug(f"Building entry rules...")
        states_to_enter = []
        # Find ancestor of 'dest_state' that has 'nca' as parent region
        ancestor_state = None

        for ts in target_states:
            logger.debug(f"Finding ancestor to {ts.name} in nca {nca.name}")
            if ancestor_state is None:
                ancestor_state = self.find_ancestor_state(ts, nca)
            else:
                assert self.find_ancestor_state(ts, nca) == ancestor_state

        if ancestor_state is not None:
            logger.debug(f"Found state: {ancestor_state.name}")

        explicit_target_regions = {}
        for ts in target_states:
            s = ts
            while s is not ancestor_state:
                pr = s.parent_region
                explicit_target_regions[pr.id] = s
                s = pr.parent_state

        if ancestor_state is not None:
            logger.debug(f"Have ancestor state {ancestor_state.name}")
            states_to_enter = self.build_entry_rules(
                [ancestor_state], explicit_target_regions
            )
        else:
            # Transition within the same region causes the target state
            # to have 'nca' as its parent region.
            states_to_enter = self.build_entry_rules(
                target_states, explicit_target_regions
            )
        logger.debug(f"Entry rules to run:")
        for s in states_to_enter:
            logger.debug(f"{s.name}")

    def find_target_states_from_fork(self, fork_state):
        result = []
        if not isinstance(fork_state, Fork):
            return result
        for t in fork_state.transitions:
            result.append(t.dest)
        return result

    def build_transition_schedule(self, hmodel):
        logger.debug("Building transition schedule")

        # Step 1 handle transitions between normal states
        for region in hmodel.regions:
            states = []
            for s in region.states:
                # Only process normal states here
                if not isinstance(s, State):
                    continue
                for t in s.transitions:
                    source = t.source

                    # Debuging, only run this rule
                    # if not (t.source.name == "D1" and t.dest.name == "C11"):
                    #    continue

                    # TODO: Handle joins
                    #   - Detect joins on source state
                    #   - Find all source states
                    #   - Check that source states are orthogonal
                    # TODO: Handle final
                    # TODO: Handle terminate

                    if isinstance(t.dest, State):
                        dest = [t.dest]
                        logger.debug(f"{source.name} --> {dest[0].name}")
                    elif isinstance(t.dest, Fork):
                        logger.debug(f"{source.name} --> fork")
                        dest = self.find_target_states_from_fork(t.dest)
                        for ts in dest:
                            logger.debug(f" --> {ts.name}")
                    else:
                        continue

                    nca = None

                    for ts in dest:
                        if nca is None:
                            nca = self.nca(source, ts)
                        else:
                            assert self.nca(source, ts) == nca

                    self.transition_exit_rules(source, nca)
                    self.transition_entry_rules(dest, nca)
        # Step 2 transitions to/from joins and forks

    def flat(self, hmodel):
        logger.debug(f"Flattning model")

        for region in hmodel.regions:
            for s in region.states:
                if isinstance(s, State):
                    self.states[s.id] = s

        self.hmodel = hmodel
        self.build_state_group(hmodel)
        self.build_initial_configuration(hmodel)
        self.build_entry_exit_rules()
        self.build_transition_schedule(hmodel)
