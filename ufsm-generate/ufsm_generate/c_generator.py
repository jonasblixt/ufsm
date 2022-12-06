import logging
import uuid
import copy
from .flat_model import *
from .model import *
from .model_utils import *

logger = logging.getLogger(__name__)

sq_template = """
unsigned int sq_len(struct {model_name}_machine *m)
{{
    if (m->head == m->tail)
        return 0;
    if (m->tail < m->head)
        return m->head + {queue_len} - m->tail;
    return m->tail - m->head;
}}

unsigned int sq_push(struct {model_name}_machine *m, unsigned int signal)
{{
    if (sq_len(m) == {queue_len})
        return 1;
    m->signal[m->head++] = signal;
    if (m->head == {queue_len})
        m->head = 0;
    return 0;
}}

unsigned int sq_pop(struct {model_name}_machine *m)
{{
    unsigned int result = m->signal[m->tail++];

    if (m->tail == {queue_len})
        m->tail = 0;

    return result;
}}
"""

def _emit(f, indent=0, output=""):
    f.write(" " * indent * 4 + output + "\n")


def _nl(f):
    _emit(f, 0, "")


def _generate_header_head(hmodel, fmodel, fh):
    _emit(fh, 0, "/* Autogenerated with uFSM */")
    _emit(fh, 0, f"#ifndef UFSM_{hmodel.name.upper()}")
    _emit(fh, 0, f"#define UFSM_{hmodel.name.upper()}")
    _nl(fh)
    _emit(fh,0, "#define UFSM_OK 0")
    _emit(fh,0, "#define UFSM_BAD_ARGUMENT 1")
    _emit(fh,0, "#define UFSM_SIGNAL_QUEUE_FULL 2")

def _generate_header_foot(hmodel, fmodel, fh):
    _nl(fh)
    _emit(fh, 0, f"#endif  // UFSM_{hmodel.name.upper()}")


def _gen_c_head(hmodel, fmodel, f):
    _emit(f, 0, "/* Autogenerated with uFSM */")
    _nl(f)
    _emit(f, 0, f"#include \"{hmodel.name}.h\"")
    _nl(f)
    if len(hmodel.signals) > 0:
        _emit(f, 0, sq_template.format(queue_len = 16, model_name=hmodel.name))

def _gen_events(hmodel, f):
    _nl(f)
    _emit(f, 0, "/* Events */")
    _emit(f, 0, "#define UFSM_RESET 0")
    for _, event in hmodel.events.items():
        _emit(f, 0, f"#define {event.name} {event.index}")

def _gen_signals(hmodel, f):
    _nl(f)
    _emit(f, 0, "/* Signals */")
    for _, signal in hmodel.signals.items():
        _emit(f, 0, f"#define {signal.name} {signal.index}")

def _gen_guard_protos(hmodel, f):
    _nl(f)
    _emit(f, 0, "/* Guard prototypes */")
    for _, guard in hmodel.guards.items():
        _emit(f, 0, f"bool {guard.name}(void *user);")


def _gen_action_protos(hmodel, f):
    _nl(f)
    _emit(f, 0, "/* Action prototypes */")
    for _, action in hmodel.actions.items():
        _emit(f, 0, f"void {action.name}(void *user);")


def _gen_machine_struct(hmodel, f):
    # TODO: Signal queue
    no_of_regions = len(hmodel.regions.items())
    _nl(f)
    _emit(f, 0, f"struct {hmodel.name}_machine {{")
    _emit(f, 1, f"unsigned int csv[{no_of_regions}];")
    _emit(f, 1, f"unsigned int wsv[{no_of_regions}];")
    _emit(f, 1, f"unsigned int signal[16];")
    _emit(f, 1, f"unsigned int head;")
    _emit(f, 1, f"unsigned int tail;")
    _emit(f, 1, "void *user;")
    _emit(f, 0, "};")

    _nl(f)
    _emit(f, 0, f"int {hmodel.name}_process(struct {hmodel.name}_machine *m, unsigned int event);")

def _sc_expr_helper(rule, vector="csv"):
    result = " && ".join(f"(m->{vector}[{s.parent.index}] == {s.index})" for s in rule.states)
    if rule.invert:
        result = f"!({result})"
    return result


def _gen_transition_exits(hmodel, fmodel, f, ft, indent):
    _emit(f, indent, "/* Exit actions */")
    for ex in ft.exits:
        if len(ex.rule.states) > 0:
            _emit(f, indent, f"if ({_sc_expr_helper(ex.rule)}) {{")
            indent_extra = 1
        else:
            indent_extra = 0
        for a in ex.actions:
            if isinstance(a, ActionFunction):
                _emit(f, indent + indent_extra, f"{a.action.name}(m->user);")
            elif isinstance(a, ActionSignal):
                _emit(f, indent + indent_extra, f"if(sq_push(m, {a.signal.index}) != 0)")
                _emit(f, indent + indent_extra + 1, f"return -UFSM_SIGNAL_QUEUE_FULL;")
        if len(ex.rule.states) > 0:
            _emit(f, indent, "}")

def _gen_transition_actions(hmodel, fmodel, f, ft, indent):
    _emit(f, indent, "/* Actions */")
    for a in ft.actions:
        if isinstance(a, ActionFunction):
            _emit(f, indent, f"{a.action.name}(m->user);")
        elif isinstance(a, ActionSignal):
            _emit(f, indent, f"if(sq_push(m, {a.signal.index}) != 0)")
            _emit(f, indent + 1, f"return -UFSM_SIGNAL_QUEUE_FULL;")


def _gen_transition_entries(hmodel, fmodel, f, ft, indent):
    _emit(f, indent, "/* Entry actions */")
    for en in ft.entries:
        indent_extra = 0
        if len(en.rule.states) > 0:
            _emit(f, indent, f"if ({_sc_expr_helper(en.rule, 'wsv')}) {{")
            indent_extra = 1
        else:
            indent_extra = 0
        for t in en.targets:
            if en.rule.history:
                _emit(f, indent + indent_extra, f"if (m->csv[{t.parent.index}] == {t.index}) {{")
                indent_extra += 1
                _emit(f, indent + indent_extra, f"m->wsv[{t.parent.index}] = {t.index};")
            else:
                _emit(f, indent + indent_extra, f"m->wsv[{t.parent.index}] = {t.index};")
            # If the target state has an out-bound, trigger-less transition
            #  we set 'process_trigger_less' to enable the trigger-less loop.
            for trans in t.transitions:
                if trans.trigger != None:
                    if trans.trigger.id == uuid.UUID("96b19d77-57c8-4219-8784-8c846f5bbb53"):
                        _emit(f, indent + indent_extra, "process_trigger_less = 1;")
        for a in en.actions:
            if isinstance(a, ActionFunction):
                _emit(f, indent + indent_extra, f"{a.action.name}(m->user);")
            elif isinstance(a, ActionSignal):
                _emit(f, indent + indent_extra, f"if(sq_push(m, {a.signal.index}) != 0)")
                _emit(f, indent + indent_extra + 1, f"return -UFSM_SIGNAL_QUEUE_FULL;")
        if en.rule.history:
            indent_extra -= 1
            _emit(f, indent + indent_extra, "}")
        if len(en.rule.states) > 0:
            _emit(f, indent, "}")

def _gen_transition_inner(hmodel, fmodel, f, ft, rules, indent):
    r = rules[0]
    _emit(f, indent, f"if ({_sc_expr_helper(r)}) {{")

    if len(rules) > 1:
        _gen_transition_inner(hmodel, fmodel, f, ft, rules[1:], indent + 1)
    else:
        _gen_transition_exits(hmodel, fmodel, f, ft, indent + 1)
        _gen_transition_actions(hmodel, fmodel, f, ft, indent + 1)
        _gen_transition_entries(hmodel, fmodel, f, ft, indent + 1)

    _emit(f, indent, "}")

def _gen_reset_vector(hmodel, fmodel, f):
    for r in fmodel.isv:
        s = r.targets[0]
        _emit(f, 3, f"m->wsv[{s.parent.index}] = {s.index};")

    for r in fmodel.isv:
        s = r.targets[0]
        indent = 3

        if len(r.rule.states) > 0:
            _emit(f, indent, f"if ({_sc_expr_helper(r.rule, vector='wsv')}) {{")
            indent += 1

        # TODO: Signals
        for a in r.actions:
            _emit(f, indent, f"{a.action.name}(m->user);")
        for entry in s.entries:
            _emit(f, indent, f"{entry.action.name}(m->user);")

        if len(r.rule.states) > 0:
            indent -= 1
            _emit(f, indent, "}")


def _gen_transition(hmodel, fmodel, f, ft, indent):
    _emit(f, indent, f"/* {ft.source.name} -> {ft.dest.name} */")
    _gen_transition_inner(hmodel, fmodel, f, ft, ft.rules, indent)


def _gen_process_func(hmodel, fmodel, f):
    _nl(f)
    _emit(f, 0, f"int {hmodel.name}_process(struct {hmodel.name}_machine *m, unsigned int event)")
    _emit(f, 0, "{")
    _emit(f, 1, "unsigned int process_trigger_less = 0;")
    _emit(f, 0, "process_more:")
    _nl(f)

    # Events
    _emit(f, 1, f"for (unsigned int i = 0; i < {hmodel.no_of_regions}; i++)")
    _emit(f, 2, "m->wsv[i] = 0;")
    _nl(f)
    _emit(f, 1, "switch(event) {")
    _emit(f, 2, "case UFSM_RESET:")
    _gen_reset_vector(hmodel, fmodel, f)
    _emit(f, 2, "break;")
    for _, event in hmodel.events.items():
        _emit(f, 2, f"case {event.name}:")
        # Trigger-less, reserved UUID, special event
        if event.id == uuid.UUID("96b19d77-57c8-4219-8784-8c846f5bbb53"):
            _emit(f, 3, "process_trigger_less = 0;")
        for ft in fmodel.transition_schedule:
            if ft == None:
                continue
            if ft.trigger == None:
                logger.error(f"Transition with no trigger: {ft}")
                continue
            if ft.trigger.id == event.id:
                _gen_transition(hmodel, fmodel, f, ft, 3)
        _emit(f, 2, f"break;")
    _emit(f, 2, "default:")
    _emit(f, 3, "return -UFSM_BAD_ARGUMENT;")
    _emit(f, 1, "}")

    _emit(f, 1, f"for (unsigned int i = 0; i < {hmodel.no_of_regions}; i++)")
    _emit(f, 2, "if(m->wsv[i] != 0)")
    _emit(f, 3, "m->csv[i] = m->wsv[i];")
    _nl(f)

    # Signals
    if len(hmodel.signals) > 0:
        _nl(f)
        _emit(f, 1, "while(sq_len(m) > 0) {")
        _emit(f, 2, f"for (unsigned int i = 0; i < {hmodel.no_of_regions}; i++)")
        _emit(f, 3, "m->wsv[i] = 0;")
        _nl(f)
        _emit(f, 2, "switch(sq_pop(m)) {")
        for _, signal in hmodel.signals.items():
            _emit(f, 3, f"case {signal.name}:")
            for ft in fmodel.transition_schedule:
                if ft.trigger.id == signal.id:
                    _gen_transition(hmodel, fmodel, f, ft, 4)
            _emit(f, 3, f"break;")
        _emit(f, 3, "default:")
        _emit(f, 4, "return -UFSM_BAD_ARGUMENT;")
        _emit(f, 2, "}")
        _emit(f, 2, f"for (unsigned int i = 0; i < {hmodel.no_of_regions}; i++)")
        _emit(f, 3, "if(m->wsv[i] != 0)")
        _emit(f, 4, "m->csv[i] = m->wsv[i];")
        _emit(f, 1, "}")

    # Trigger-less transitions
    _emit(f, 1, "if (process_trigger_less == 1) {")
    _emit(f, 2, "event = UFSM_TRIGGER_LESS;")
    _emit(f, 2, "goto process_more;")
    _emit(f, 1, "}")

    _emit(f, 1, "return 0;")
    _emit(f, 0, "}")


def c_generator(fmodel: FlatModel, hmodel: Model, c_output, h_output):
    with open(c_output, "w") as fc, open(h_output, "w") as fh:
        _generate_header_head(hmodel, fmodel, fh)
        # Generate event defines
        _gen_events(hmodel, fh)
        _gen_signals(hmodel, fh)
        _gen_guard_protos(hmodel, fh)
        _gen_action_protos(hmodel, fh)
        _gen_machine_struct(hmodel, fh)
        # Generate guard and action function prototypes
        _generate_header_foot(hmodel, fmodel, fh)

        _gen_c_head(hmodel, fmodel, fc)
        _gen_process_func(hmodel, fmodel, fc)
