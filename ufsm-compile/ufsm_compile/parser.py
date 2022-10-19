import logging
import json
import uuid
from .model import *

logger = logging.getLogger(__name__)

UFSMM_ACTION_REF_NORMAL = 0
UFSMM_ACTION_REF_SIGNAL = 1

UFSMM_GUARD_TRUE = 0
UFSMM_GUARD_FALSE = 1
UFSMM_GUARD_EQ = 2
UFSMM_GUARD_GT = 3
UFSMM_GUARD_GTE = 4
UFSMM_GUARD_LT = 5
UFSMM_GUARD_LTE = 6
UFSMM_GUARD_PSTATE = 7
UFSMM_GUARD_NSTATE = 8


class UfsmParser:
    def __init__(self):
        self.states_lut = {}
        self.event_lut = {}
        self.signal_lut = {}
        self.guard_names_lut = {}
        self.action_lut = {}

    def parse_events(self, data):
        logger.debug(f"Parsing events")

        for t in data["events"]:
            t_name = t["name"]
            t_id = t["id"]
            logger.debug(f"Trigger {t_name}")
            event = Event(uuid.UUID(t_id), t_name)
            self.event_lut[t_id] = event
            self.model.events.append(event)

    def parse_signals(self, data):
        logger.debug(f"Parsing signals")

        for s in data["signals"]:
            s_name = s["name"]
            s_id = s["id"]
            logger.debug(f"Signal {s_name}")
            signal = Signal(uuid.UUID(s_id), s_name)
            self.signal_lut[s_id] = signal
            self.model.signals.append(signal)

    def parse_actions(self, data):
        logger.debug(f"Parsing action function names")
        for a in data["actions"]:
            a_name = a["name"]
            a_id = a["id"]
            logger.debug(f"Action {a_name}")
            action = Function(uuid.UUID(a_id), a_name)
            self.action_lut[a_id] = action

    def parse_guards(self, data):
        logger.debug(f"Parsing guard function names")
        for g in data["guards"]:
            g_name = g["name"]
            g_id = g["id"]
            logger.debug(f"Guard {g_name} {g_id}")
            self.guard_names_lut[g_id] = g_name

    def parse_region(self, region_data, parent_state):
        for region_data_elm in region_data:
            r_name = region_data_elm["name"]
            r_id = region_data_elm["id"]
            logger.debug(f"Parsing region {r_name}")
            region = Region(uuid.UUID(r_id), r_name, parent_state)

            # 'parent_state' is None for the root region
            if parent_state == None:
                self.model.root = region
            else:
                parent_state.regions.append(region)

            if len(region_data_elm["states"]) > 0:
                self.parse_state(region_data_elm["states"], region)

    def parse_state(self, state_data, parent_region):
        for state_data_elm in state_data:
            s_name = state_data_elm["name"]
            s_id = state_data_elm["id"]
            s_kind = state_data_elm["kind"]

            logger.debug(f"Parsing state {s_name}")

            if s_kind == "state":
                state = State(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "init":
                state = Init(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "final":
                state = Final(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "shallow-history":
                state = ShallowHistory(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "deep-history":
                state = DeepHistory(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "fork":
                state = Fork(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "join":
                state = Join(uuid.UUID(s_id), s_name, parent_region)
            elif s_kind == "terminate":
                state = Terminate(uuid.UUID(s_id), s_name, parent_region)
            else:
                logger.error(f"Unknown state kind {s_kind}")
                raise Exception("Unknown state kind")

            state.id = s_id
            parent_region.states.append(state)
            self.states_lut[s_id] = state

            # TODO: Signals can also be emitted as entry/exit actions
            for entry_data in state_data_elm["entries"]:
                action_id = entry_data["id"]
                function_id = entry_data["action-id"]
                action = self.action_lut[function_id]
                action_func = ActionFunction(uuid.UUID(action_id), action)
                state.entries.append(action_func)

            for exit_data in state_data_elm["exits"]:
                action_id = entry_data["id"]
                function_id = exit_data["action-id"]
                action = self.action_lut[function_id]
                action = ActionFunction(uuid.UUID(action_id), action)
                state.exits.append(action)

            for transition_data in state_data_elm["transitions"]:
                t_id = transition_data["id"]
                # TODO: Can't resolve states that have not been parsed
                # Probably do parsing in a few steps, one where all the states
                # and regions are parsed
                source_state = self.states_lut[transition_data["source"]["state"]]
                dest_state = self.states_lut[transition_data["dest"]["state"]]

                t = Transition(uuid.UUID(t_id), source_state, dest_state)

                if "event" in transition_data.keys():
                    t.trigger_id = transition_data["event"]
                    t.trigger = self.event_lut[t.trigger_id]
                elif "signal" in transition_data.keys():
                    t.trigger_id = transition_data["signal"]
                    t.trigger = self.signal_lut[t.trigger_id]

                for action_data in transition_data["actions"]:
                    action_kind = action_data["kind"]

                    if action_kind == UFSMM_ACTION_REF_NORMAL:
                        action_name = self.action_lut[action_data["action-id"]]
                        action = ActionFunction(action_name, uuid.UUID(action_data["id"]))
                        logger.debug(f"Added action function {action_name}()")
                        t.add_action(action)
                    elif action_kind == UFSMM_ACTION_REF_SIGNAL:
                        signal_id = action_data["signal-id"]
                        signal = self.signal_lut[signal_id]
                        action_signal = ActionSignal(signal.name, signal)
                        t.add_action(action_signal)
                        logger.debug(f"Added signal action ^{signal.name}")
                    else:
                        logger.error(f"Unhandled action")

                for guard_data in transition_data["guards"]:
                    kind = guard_data["kind"]

                    if kind == UFSMM_GUARD_PSTATE:
                        guard = GuardPState(guard_data["state-id"])
                    elif kind == UFSMM_GUARD_NSTATE:
                        guard = GuardNState(guard_data["state-id"])
                    else:
                        name = self.guard_names_lut[guard_data["action-id"]]
                        guard = Guard(name)

                    t.add_guard(guard)

                state.add_transition(t)
                self.model.add_transition(t)
            if len(state_data_elm["region"]) > 0:
                self.parse_region(state_data_elm["region"], state)

    def parse_transitions(self):
        pass
    def parse_root_region(self, data):
        root_region_data = [data["region"]]
        self.parse_region(root_region_data, None)

    def resolve_transitions(self):
        for state_key in self.states_lut:
            s = self.states_lut[state_key]
            for t in s.transitions:
                t.source = self.states_lut[t.source_id]
                t.dest = self.states_lut[t.dest_id]
                trigger_name = "trigger-less"
                if t.trigger_id != None:
                    trigger_name = t.trigger.name
                logger.debug(
                    f"Resolved transition [{trigger_name}] "
                    + f"{t.source.name} -> {t.dest.name}"
                )

                if t.guards:
                    for g in t.guards:
                        if isinstance(g, GuardPState):
                            g_id = g.state_id
                            state_ref = self.states_lut[g_id]
                            g.name = state_ref.name
                            g.state = state_ref
                        if isinstance(g, GuardNState):
                            g_id = g.state_id
                            state_ref = self.states_lut[g_id]
                            g.name = "!" + state_ref.name
                            g.state = state_ref
                    logger.debug(f"    guards:")
                    for g in t.guards:
                        logger.debug(f"       {g.name}")

                if t.actions:
                    logger.debug(f"    actions:")
                    for a in t.actions:
                        logger.debug(f"       {a.name}")

    def parse(self, model_fn):
        logger.debug(f"Parsing {model_fn}")

        with open(model_fn) as f:
            raw_json_data = f.read()
            logger.debug("Read %i bytes" % (len(raw_json_data)))

        data = json.loads(raw_json_data)
        model_name = data["name"]
        model_version = data["version"]
        model_kind = data["kind"]

        assert model_kind == "uFSM Model"

        logger.debug(f"Loaded model: {model_name}, version {model_version}")

        self.model = Model()
        self.model.name = model_name

        self.parse_events(data)
        self.parse_signals(data)
        self.parse_actions(data)
        self.parse_guards(data)
        self.parse_root_region(data)
        self.resolve_transitions()

        return self.model
