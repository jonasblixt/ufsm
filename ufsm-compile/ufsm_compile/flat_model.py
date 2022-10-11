class StateConditionGroup:
    def __init__(self):
        pass


class Rule:
    def __init__(self):
        self.conditions = []
        self.actions = []
        self.target_states = []

    def add_state_conditions(self, state, conditions):
        if state:
            self.conditions = [state] + conditions
        else:
            self.conditions = conditions

    def add_actions(self, actions):
        self.actions = actions

    def add_target_state(self, state):
        self.target_states.append(state)

    def __str__(self):
        if len(self.conditions) == 0:
            result = "true"
        else:
            result = "^".join(s.name for s in self.conditions)
        result += " / " + ", ".join(a.name for a in self.actions)
        return result


class TransitionSchedule:
    def __init__(self):
        self.pos_state_conditions = []
        self.neg_state_conditions = []
        self.event_trigger = None
        self.guards = []

    def add_positive_state_conditions(self, states):
        self.pos_state_conditions += states

    def add_negative_state_conditions(self, states):
        self.neg_state_conditions += states

    def set_event_trigger(self, event):
        self.event_trigger = event

    def add_guard(self, guard):
        self.guards.apped(guard)

    def add_exit_rule(self, exit_rule):
        pass

    def add_entry_rule(self, entry_rule):
        pass

    def add_action(self, action):
        pass

    def add_signal_output(self, action):
        pass
