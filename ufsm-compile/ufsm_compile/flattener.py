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
        logger.debug('Building state groups')
        for region in hmodel.regions:
            states = []
            for s in region.states:
                if isinstance(s, State):
                    states.append(s)
            self.state_groups[region.id] = states

            output_string = ""
            for group_name in self.state_groups.keys():
                output_string += "{"
                output_string = output_string + \
                        ', '.join(s.name for s in self.state_groups[group_name])

                output_string += "}, "
        logger.debug('M = ' + output_string)
    def build_initial_configuration(self, hmodel):
        logger.debug('Building initial configuration')
        for region in hmodel.regions:
            for s in region.states:
                if isinstance(s, Init) or isinstance(s, ShallowHistory) or \
                        isinstance(s, DeepHistory):
                    t = s.transitions[0]
                    #logger.debug(f'Region {region.name} -> {t.dest.name}')
                    self.initial_configuration.append(t.dest)
        output_string = ', '.join(s.name for s in self.initial_configuration)
        logger.debug(f's0 = {output_string}')
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
        logger.debug('Building exit rules')
        for s_id in self.states.keys():
            s = self.states[s_id]
            parent_states = self.parent_states(s)
            rule = Rule()
            rule.add_state_conditions(s, parent_states)
            rule.add_actions(s.exits)
            logger.debug('x: ' + str(rule))
            self.exit_rules[s_id] = rule

            rule = Rule()
            rule.add_state_conditions(None, parent_states)
            rule.add_actions(s.entries)
            logger.debug('e: ' + str(rule))
            self.entry_rules[s_id] = rule
    def flat(self, hmodel):
        logger.debug(f'Flattning model')

        for region in hmodel.regions:
            for s in region.states:
                if isinstance(s, State):
                    self.states[s.id] = s

        self.hmodel = hmodel
        self.build_state_group(hmodel)
        self.build_initial_configuration(hmodel)
        self.build_entry_exit_rules()

