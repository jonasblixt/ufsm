from dataclasses import dataclass, field
from uuid import UUID
from typing import List, Any

@dataclass
class Event:
    """Model wide event object.
       Events are numerical inputs to the state machine that triggers the
       machine to do something.
    """
    id: UUID
    name: str

@dataclass
class Signal:
    """Model wide signal object. Signals are events that are internal to the state
    machine. Signals can be emitted as entry/exit actions or transition
    actions."""
    id: UUID
    name: str

@dataclass
class Function:
    """Model wide function. An function object represents a function
    that's callable by the state machine, either by an entry/exit or
    a transition action."""
    id: UUID
    name: str

@dataclass
class Guard:
    """Model wide guard function. A guard function is an external function
    callable by the statemachine which should return true or false."""
    id: UUID
    name: str

# TODO: ActionBase, ActionFunction and ActionSignal
# These objects represents the 'instance' when, for example, an action fuction
# is added as an entry action. In the future these objects might also contain
# parameters to function, which of course could be different when called from
# different places in the state machine.
#
# The names are however confusing
@dataclass
class ActionBase:
    """Base object for state machine actions. These can be function calls
    or actions that emit signals."""
    id: UUID

@dataclass
class ActionFunction(ActionBase):
    action: Function

@dataclass
class ActionSignal(ActionBase):
    signal: Signal

@dataclass
class GuardBase:
    id: UUID

@dataclass
class GuardFunction(GuardBase):
    name: str
    guard: Guard

@dataclass
class Transition:
    id: UUID
    source: Any # Should be 'StateBase'
    dest: Any   # Should be 'StateBase'
    trigger: Event = None
    guards: List[GuardBase] = field(default_factory=list)
    actions: List[ActionBase] = field(default_factory=list)

@dataclass
class Region:
    id: UUID
    name: str
    parent: Any
    states: List[Any] = field(default_factory=list)

@dataclass
class StateBase:
    id: UUID
    name: str
    parent: Region
    transitions: List[Transition] = field(default_factory=list)

@dataclass
class State(StateBase):
    entries: List[ActionBase] = field(default_factory=list)
    exits: List[ActionBase] = field(default_factory=list)
    regions: List[Region] = field(default_factory=list)

@dataclass
class GuardStateCondition(GuardBase):
    pstate: State
    nstate: State

@dataclass
class Init(StateBase):
    pass

@dataclass
class ShallowHistory(StateBase):
    pass

@dataclass
class DeepHistory(StateBase):
    pass

@dataclass
class Join(StateBase):
    pass

@dataclass
class Fork(StateBase):
    pass

@dataclass
class Final(StateBase):
    pass

@dataclass
class Terminate(StateBase):
    pass

@dataclass
class Model:
    name: str = ""
    events: List[Event] = field(default_factory=list) 
    signals: List[Signal] = field(default_factory=list) 
    guards: List[Guard] = field(default_factory=list) 
    functions: List[Function] = field(default_factory=list) 
    root: Region = None

