
class Rule:
    def __init__(self):
        self.conditions = []
        self.actions = []
    def add_state_conditions(self, state, conditions):
        if state:
            self.conditions = [state] + conditions
        else:
            self.conditions = conditions

    def add_actions(self, actions):
        self.actions = actions
    def __str__(self):
        if len(self.conditions) == 0:
            result = 'true'
        else:
            result = '^'.join(s.name for s in self.conditions)
        result += ' / ' + ', '.join(a.name for a in self.actions)
        return result
