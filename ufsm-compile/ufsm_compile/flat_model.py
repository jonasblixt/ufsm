from dataclasses import dataclass, field
from uuid import UUID
from typing import List, Any, Dict
from .model import *


@dataclass
class Rule:
    invert: bool = False
    states: List[State] = field(default_factory=list)

    def __str__(self):
        if len(self.states) == 0:
            return "True"

        result = ""
        if self.invert:
            result = "¬"

        result += "(" + "^".join(s.name for s in self.states) + ")"
        return result


@dataclass
class EntryRule:
    rule: Rule
    target: State
    actions: List[ActionBase] = field(default_factory=list)

    def __str__(self):
        result = f"{self.rule}"
        result += " / " + ", ".join(str(a) for a in self.actions)
        result += f" → {self.target.name}"
        return result


@dataclass
class ExitRule:
    rule: Rule
    state: State
    actions: List[ActionBase] = field(default_factory=list)

    def __str__(self):
        result = f"{self.rule}"
        result += " / " + ", ".join(str(a) for a in self.actions)
        return result


@dataclass
class FlatTransition:
    trigger: Any
    source: State
    dest: State
    rules: List[Rule] = field(default_factory=list)
    guard_funcs: List[GuardFunction] = field(default_factory=list)
    exits: List[ExitRule] = field(default_factory=list)
    actions: List[ActionBase] = field(default_factory=list)
    entries: List[EntryRule] = field(default_factory=list)

    def __str__(self):
        result = f"{self.source.name} ["

        if self.trigger != None:
            resutl += f"{self.trigger.name}: "
        else:
            result += "true: "

        result += "^ ".join(str(r) for r in self.rules)
        result += "^ ".join(str(g) for g in self.guard_funcs)
        result += "] "
        result += "/ " + ", ".join(str(a) for a in self.actions)
        result += f" → {self.dest}"

        # TODO: Entry/Exit rules
        return result


@dataclass
class FlatModel:
    exit_rules: Dict[UUID, ExitRule] = field(default_factory=dict)
    entry_rules: Dict[UUID, EntryRule] = field(default_factory=dict)
    history_rules: Dict[UUID, List[EntryRule]] = field(default_factory=dict)
    transitions: List[FlatTransition] = field(default_factory=list)
