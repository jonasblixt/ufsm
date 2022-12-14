import logging
import json
import uuid
from .model import *

logger = logging.getLogger(__name__)

def _parse_triggers(model, data):
    logger.debug(f"Parsing triggers")
    index = 10 # 0 - 9 are reserved
    for t in data["triggers"]:
        t_name = t["name"]
        t_id = t["id"]
        logger.debug(f"Trigger {t_name}")
        event = Event(uuid.UUID(t_id), t_name, index)
        index += 1
        model.events[event.id] = event


def _parse_signals(model, data):
    logger.debug(f"Parsing signals")
    index = 10 # 0 - 9 Are reserved
    for s in data["signals"]:
        s_name = s["name"]
        s_id = s["id"]
        logger.debug(f"Signal {s_name}")
        signal = Signal(uuid.UUID(s_id), s_name, index)
        index += 1
        model.signals[signal.id] = signal


def _parse_actions(model, data):
    logger.debug(f"Parsing action function names")
    for a in data["actions"]:
        a_name = a["name"]
        a_id = uuid.UUID(a["id"])
        logger.debug(f"Action {a_name}")
        action = Function(a_id, a_name)
        model.actions[a_id] = action


def _parse_guards(model, data):
    logger.debug(f"Parsing guard function names")
    for g in data["guards"]:
        g_name = g["name"]
        g_id = g["id"]
        logger.debug(f"Guard {g_name} {g_id}")
        guard = Guard(uuid.UUID(g_id), g_name)
        model.guards[guard.id] = guard


def _parse_region(model, region_data, parent_state):
    for region_data_elm in region_data:
        r_name = region_data_elm["name"]
        r_id = uuid.UUID(region_data_elm["id"])
        logger.debug(f"R {r_id} {r_name}")
        region_index = model.no_of_regions
        model.no_of_regions += 1
        region = Region(r_id, r_name, parent_state, region_index)

        model.regions[r_id] = region

        # 'parent_state' is None for the root region
        if parent_state == None:
            model.root = region
        else:
            parent_state.regions.append(region)

        if len(region_data_elm["states"]) > 0:
            _parse_state(model, region_data_elm["states"], region)


def _parse_state(model, state_data, parent_region):
    for state_data_elm in state_data:
        s_name = state_data_elm["name"]
        s_id = uuid.UUID(state_data_elm["id"])
        s_kind = state_data_elm["kind"]

        logger.debug(f"S {s_id} {s_name}")

        if s_kind == "state":
            state_index = model.no_of_states + 1
            model.no_of_states += 1
            state = State(s_id, s_name, parent_region, state_index)
        elif s_kind == "init":
            state = Init(s_id, s_name, parent_region)
        elif s_kind == "final":
            state_index = model.no_of_states + 1
            model.no_of_states += 1
            state = Final(s_id, s_name, parent_region, state_index)
        elif s_kind == "shallow-history":
            state = ShallowHistory(s_id, s_name, parent_region)
        elif s_kind == "deep-history":
            state = DeepHistory(s_id, s_name, parent_region)
        elif s_kind == "fork":
            state = Fork(s_id, s_name, parent_region)
        elif s_kind == "join":
            state = Join(s_id, s_name, parent_region)
        elif s_kind == "terminate":
            state = Terminate(s_id, s_name, parent_region)
        else:
            logger.error(f"Unknown state kind {s_kind}")
            raise Exception("Unknown state kind")

        parent_region.states.append(state)
        model.states[s_id] = state

        # TODO: Signals can also be emitted as entry/exit actions
        for entry_data in state_data_elm["entries"]:
            action_id = entry_data["id"]
            action_kind = entry_data["kind"]

            if action_kind == UFSMM_ACTION_REF_NORMAL:
                function_id = uuid.UUID(entry_data["action-id"])
                action = model.actions[function_id]
                action_func = ActionFunction(uuid.UUID(action_id), action)
                state.entries.append(action_func)
            elif action_kind == UFSMM_ACTION_REF_SIGNAL:
                signal_id = entry_data["signal-id"]
                signal = model.signals[uuid.UUID(signal_id)]
                action_signal = ActionSignal(signal.name, signal)
                state.entries.append(action_signal)
                logger.debug(f"Added signal action ^{signal.name}")

        for exit_data in state_data_elm["exits"]:
            action_id = entry_data["id"]

            if action_kind == UFSMM_ACTION_REF_NORMAL:
                function_id = uuid.UUID(exit_data["action-id"])
                action = model.actions[function_id]
                action = ActionFunction(uuid.UUID(action_id), action)
                state.exits.append(action)
            elif action_kind == UFSMM_ACTION_REF_SIGNAL:
                signal_id = exit_data["signal-id"]
                signal = model.signals[uuid.UUID(signal_id)]
                action_signal = ActionSignal(signal.name, signal)
                state.exits.append(action_signal)
                logger.debug(f"Added signal action ^{signal.name}")
        if len(state_data_elm["region"]) > 0:
            _parse_region(model, state_data_elm["region"], state)


def _parse_one_transition(model, transition_data):
    t_id = uuid.UUID(transition_data["id"])
    # TODO: 'state' should probably be 'state-id'
    source_id = uuid.UUID(transition_data["source"]["state"])
    dest_id = uuid.UUID(transition_data["dest"]["state"])
    source_state = model.states[source_id]
    dest_state = model.states[dest_id]

    logging.debug(
        f"Parsing transition {t_id} {source_state.name} → " f"{dest_state.name}"
    )
    t = Transition(t_id, source_state, dest_state)
    source_state.transitions.append(t)

    if "trigger" in transition_data.keys():
        t.trigger_id = transition_data["trigger"]
    else:
        t.trigger_id = None

    if "trigger-kind" in transition_data.keys():
        kind = transition_data["trigger-kind"]

        if (kind == UFSMM_TRIGGER_EVENT) and t.trigger_id:
            t.trigger = model.events[uuid.UUID(t.trigger_id)]
        elif (kind == UFSMM_TRIGGER_SIGNAL) and t.trigger_id:
            t.trigger = model.signals[uuid.UUID(t.trigger_id)]
        elif kind == UFSMM_TRIGGER_AUTO:
            model.no_of_auto_transitions += 1
            t.trigger = AutoTransitionTrigger()
        elif kind == UFSMM_TRIGGER_COMPLETION:
            t.trigger = CompletionTrigger()

    # Some transitions don't have triggers, for example transitions from
    #  init states.

    for action_data in transition_data["actions"]:
        action_kind = action_data["kind"]

        if action_kind == UFSMM_ACTION_REF_NORMAL:
            a_id = uuid.UUID(action_data["action-id"])
            f_id = uuid.UUID(action_data["id"])
            action_func = model.actions[a_id]
            action = ActionFunction(a_id, action_func)
            logger.debug(f"Added action function {action_func.name}()")
            t.actions.append(action)
        elif action_kind == UFSMM_ACTION_REF_SIGNAL:
            signal_id = action_data["signal-id"]
            signal = model.signals[uuid.UUID(signal_id)]
            action_signal = ActionSignal(signal.name, signal)
            t.actions.append(action_signal)
            logger.debug(f"Added signal action ^{signal.name}")
        else:
            logger.error(f"Unhandled action")

    for guard_data in transition_data["guards"]:
        kind = guard_data["kind"]

        if kind == UFSMM_GUARD_PSTATE:
            state_id = uuid.UUID(guard_data["state-id"])
            g_state = model.states[state_id]
            g_id = uuid.UUID(guard_data["id"])
            guard = GuardPState(g_id, g_state)
        elif kind == UFSMM_GUARD_NSTATE:
            state_id = uuid.UUID(guard_data["state-id"])
            g_state = model.states[state_id]
            g_id = uuid.UUID(guard_data["id"])
            guard = GuardNState(g_id, g_state)
        else:
            g_id = uuid.UUID(guard_data["id"])
            g_action_id = uuid.UUID(guard_data["action-id"])
            g_val = guard_data["value"]
            g = model.guards[g_action_id]
            guard = GuardFunction(g_id, g, g_val, kind)
        t.guards.append(guard)
    model.transitions.append(t)

def _parse_transition_state(model, state_data):
    for transition_data in state_data["transitions"]:
        _parse_one_transition(model, transition_data)
    for region_data in state_data["region"]:
        _parse_transition_region(model, region_data)


def _parse_transition_region(model, region_data):
    for state_data in region_data["states"]:
        _parse_transition_state(model, state_data)


def _parse_transitions(model, data):
    root_region_data = data["region"]
    _parse_transition_region(model, root_region_data)


def _parse_root_region(model, data):
    root_region_data = [data["region"]]
    _parse_region(model, root_region_data, None)


def ufsm_parse_model(model_filename: str) -> Model:
    logger.debug(f"Parsing {model_filename}")

    with open(model_filename) as f:
        raw_json_data = f.read()
        logger.debug("Read %i bytes" % (len(raw_json_data)))

    data = json.loads(raw_json_data)
    model_name = data["name"]
    model_version = data["version"]
    model_kind = data["kind"]

    assert model_kind == "uFSM Model"

    logger.debug(f"Loaded model: {model_name}, version {model_version}")

    model = Model(model_name, model_version, model_kind)

    _parse_triggers(model, data)
    _parse_signals(model, data)
    _parse_actions(model, data)
    _parse_guards(model, data)
    _parse_root_region(model, data)
    _parse_transitions(model, data)

    return model
