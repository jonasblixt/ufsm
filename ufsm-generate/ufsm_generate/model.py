from dataclasses import dataclass, field
from uuid import UUID
from typing import List, Any, Dict

UFSMM_TRIGGER_EVENT = 0
UFSMM_TRIGGER_SIGNAL = 1
UFSMM_TRIGGER_AUTO = 2
UFSMM_TRIGGER_COMPLETION = 3

@dataclass
class Event:
    """Model wide event object.
    Events are numerical inputs to the state machine that triggers the
    machine to do something.
    """

    id: UUID
    name: str
    index: int

    def __str__(self):
        return f"<{self.name}>"

@dataclass
class AutoTransitionTrigger:
    def __str__(self):
        return "<auto-transition>"

@dataclass
class CompletionTrigger:
    def __str__(self):
        return "<completion-event>"

@dataclass
class Signal:
    """Model wide signal object. Signals are events that are internal to the state
    machine. Signals can be emitted as entry/exit actions or transition
    actions."""

    id: UUID
    name: str
    index: int

    def __str__(self):
        return f"<{self.name}>"


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
    def __str__(self):
        return f"{self.name}()"

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

    def __str__(self):
        return f"{self.action.name}()"


@dataclass
class ActionSignal(ActionBase):
    signal: Signal

    def __str__(self):
        return f"^{self.signal.name}"


@dataclass
class GuardBase:
    id: UUID


@dataclass
class GuardFunction(GuardBase):
    guard: Guard


@dataclass
class Transition:
    id: UUID
    source: Any  # Should be 'StateBase'
    dest: Any  # Should be 'StateBase'
    trigger: Any = None  # Can be either Event or Signal
    guards: List[GuardBase] = field(default_factory=list)
    actions: List[ActionBase] = field(default_factory=list)


@dataclass
class Region:
    id: UUID
    name: str
    parent: Any
    index: int
    states: List[Any] = field(default_factory=list)

    def __str__(self):
        return self.name


@dataclass
class StateBase:
    id: UUID
    name: str
    parent: Region
    index: int = 0
    transitions: List[Transition] = field(default_factory=list)

    def __str__(self):
        return self.name
    def __eq__(self, other):
        return (self.id == other.id)

@dataclass
class State(StateBase):
    entries: List[ActionBase] = field(default_factory=list)
    exits: List[ActionBase] = field(default_factory=list)
    regions: List[Region] = field(default_factory=list)


@dataclass
class GuardPState(GuardBase):
    state: State


@dataclass
class GuardNState(GuardBase):
    state: State


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
    name: str
    version: str
    kind: str
    no_of_regions: int = 0
    no_of_states: int = 0
    events: Dict[UUID, Event] = field(default_factory=dict)
    signals: Dict[UUID, Signal] = field(default_factory=dict)
    guards: Dict[UUID, Guard] = field(default_factory=dict)
    actions: Dict[UUID, Function] = field(default_factory=dict)
    states: Dict[UUID, StateBase] = field(default_factory=dict)
    regions: Dict[UUID, Region] = field(default_factory=dict)
    transitions: List[Transition] = field(default_factory=list)
    root: Region = None
