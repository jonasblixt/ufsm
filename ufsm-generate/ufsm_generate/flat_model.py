from dataclasses import dataclass, field
from uuid import UUID
from typing import List, Any, Dict
from .model import *


@dataclass
class Rule:
    invert: bool = False
    history: bool = False
    states: List[State] = field(default_factory=list)

    def __str__(self):
        if len(self.states) == 0:
            return "True"

        result = ""
        if self.history:
            result += "H "
        if self.invert:
            result += "¬"

        result += "(" + "^".join(s.name for s in self.states) + ")"
        return result

    def __eq__(self, other):
        result = (self.invert == other.invert)
        set1 = set((x.id) for x in self.states)
        set2 = set((x.id) for x in other.states)
        return result and (set1 == set2)

@dataclass
class EntryRule:
    rule: Rule
    targets: List[State] = field(default_factory=list)
    actions: List[ActionBase] = field(default_factory=list)

    def __str__(self):
        result = f"{self.rule}"
        result += " / " + ", ".join(str(a) for a in self.actions)
        result += f" → " + ", ".join(str(s) for s in self.targets)
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
        result = ""
        result += f"{self.trigger} {self.source} → {self.dest}\n"
        result += f"State conditions:\n"

        for r in self.rules:
            result += f"    {r}\n"

        if len(self.guard_funcs) > 0:
            result += f"Guard functions to call:\n"

            for g in self.guard_funcs:
                result += f"    {g}\n"

        result += f"Exit rules to run:\n"
        for r in self.exits:
            result += f"    {r}\n"

        if len(self.actions) > 0:
            result += f"Actions to run\n"

            for action in self.actions:
                result += f"    {action}\n"

        result += f"Entry rules to run:\n"

        for r in self.entries:
            result += f"    {r}\n"

        return result


@dataclass
class FlatModel:
    exit_rules: Dict[UUID, ExitRule] = field(default_factory=dict)
    entry_rules: Dict[UUID, EntryRule] = field(default_factory=dict)
    history_rules: Dict[UUID, List[EntryRule]] = field(default_factory=dict)
    isv: List[FlatTransition] = field(default_factory=list)
    transition_schedule: List[FlatTransition] = field(default_factory=list)
