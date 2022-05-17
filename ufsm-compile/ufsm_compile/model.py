import logging

class Event:
    def __init__(self, name):
        self._name = name
        self._id = ""
    @property
    def name(self):
        return self._name
    @property
    def id(self):
        return self._id
    @id.setter
    def id(self, id):
        self._id = id

class Signal:
    def __init__(self, name):
        self._name = name
        self._id = ""
    @property
    def name(self):
        return self._name
    @property
    def id(self):
        return self._id
    @id.setter
    def id(self, id):
        self._id = id

class Action:
    def __init__(self, name):
        self._name = name
    @property
    def name(self):
        return self._name

class ActionFunction(Action):
    def __init__(self, name):
        Action.__init__(self, name)

class ActionSignal(Action):
    def __init__(self, name, signal):
        Action.__init__(self, name)
        self._signal = signal
    def _signal_get(self):
        return self._signal
    def _signal_set(self, signal):
        self._singal = singal

    signal = property(_signal_get, _signal_set, None, 'Signal object')

class Guard:
    def __init__(self, name):
        self.name = name

class GuardPState(Guard):
    def __init__(self, state_id):
        Guard.__init__(self, '')
        self.state_id = state_id
        self.state = None

class GuardNState(Guard):
    def __init__(self, state_id):
        Guard.__init__(self, '')
        self.state_id = state_id
        self.state = None

class Transition:
    def __init__(self, source = None, dest = None):
        self._trigger = None
        self._trigger_id = None
        self._source = source
        self._dest = dest
        self._source_id = ""
        self._dest_id = ""
        self._guards = []
        self._actions = []
        self._signals = []
    @property
    def trigger_id(self):
        return self._trigger_id
    @trigger_id.setter
    def trigger_id(self, trigger_id):
        self._trigger_id = trigger_id
    @property
    def source(self):
        return self._source
    @source.setter
    def source(self, source_state):
        self._source = source_state
    @property
    def dest(self):
        return self._dest
    @dest.setter
    def dest(self, dest_state):
        self._dest = dest_state
    @property
    def source_id(self):
        return self._source_id
    @source_id.setter
    def source_id(self, source_id):
        self._source_id = source_id
    @property
    def dest_id(self):
        return self._dest_id
    @dest_id.setter
    def dest_id(self, dest_id):
        self._dest_id = dest_id
    @property
    def trigger(self):
        return self._trigger
    @trigger.setter
    def trigger(self, trigger):
        self._trigger = trigger
    @property
    def guards(self):
        return self._guards
    def add_guard(self, guard):
        self._guards.append(guard)
    @property
    def actions(self):
        return self._actions
    def add_action(self, action):
        self._actions.append(action)

class Region:
    def __init__(self, name, parent_state):
        self._name = name
        self._parent_state = parent_state
        self._states = []
    def add_state(self, state):
        self._states.append(state)
    def _name_get(self):
        return self._name
    def _parent_state_get(self):
        return self._parent_state
    def _states_get(self):
        return self._states
    def _id_get(self):
        return self._id
    def _id_set(self, id):
        self._id = id

    id = property(_id_get, _id_set, None, "State ID")
    parent_state = property(_parent_state_get, None, None, "Parent State")
    name = property(_name_get, None, None, "Name")
    states = property(_states_get, None, None, "States")

class StateBase:
    def __init__(self, name, parent_region):
        self._name = name
        self._parent_region = parent_region
        self._id = ""
        self._transitions = []
    def add_region(self, region):
        self.regions.append(region)
    def _name_get(self):
        return self._name
    def _name_set(self, name):
        self._name = name
    def _pr_get(self):
        return self._parent_region
    def _pr_set(self, pr):
        self._parent_region = pr
    def _id_get(self):
        return self._id
    def _id_set(self, id):
        self._id = id
    def _transitions_get(self):
        return self._transitions
    def add_transition(self, transition):
        self._transitions.append(transition)

    transitions = property(_transitions_get, None, None, 'Get transitions')
    id = property(_id_get, _id_set, None, "State ID")
    name = property(_name_get, _name_set, None, "State name")
    parent_region = property(_pr_get, _pr_set, None, "State parent region")

class State(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
        self._entries = []
        self._exits = []
        self._regions = []
    def _entries_get(self):
        return self._entries
    def add_entry(self, action):
        self._entries.append(action)
    def _exits_get(self):
        return self._exits
    def add_exit(self, action):
        self._exits.append(action)
    def _regions_get(self):
        return self._regions

    regions = property(_regions_get, None, None, 'Get regions')
    entries = property(_entries_get, None, None, 'Get entries')
    exits = property(_exits_get, None, None, 'Get exits')

class Init(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class ShallowHistory(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class DeepHistory(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class Join(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class Fork(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class Final(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)
class Terminate(StateBase):
    def __init__(self, name, parent_region):
        StateBase.__init__(self, name, parent_region)


class Model:
    def __init__(self):
        self._events = []
        self._signals = []
        self._transitions = []
        self._regions = []
        self._root_region = None
        self._name = ""
    @property
    def events(self):
        return self._events
    def add_event(self, event):
        self._events.append(event)
    def add_signal(self, signal):
        self._signals.append(signal)
    def add_region(self, region):
        self._regions.append(region)
    def _name_get(self):
        return self._name
    def _name_set(self, name):
        self._name = name
    def _regions_get(self):
        return self._regions
    def _version_get(self):
        return self._version
    def _version_set(self, version):
        self._version = version
    def _root_get(self):
        return self._root_region
    def _root_set(self, root_region):
        self._root_region = root_region
    def _transitions_get(self):
        return self._transitions
    def add_transition(self, transition):
        self._transitions.append(transition)

    name = property(_name_get, _name_set, None, 'Model name')
    root = property(_root_get, _root_set, None, 'Model root region')
    transitions = property(_transitions_get, None, None, 'Model transitions')
    regions = property(_regions_get, None, None, 'Model regions')
