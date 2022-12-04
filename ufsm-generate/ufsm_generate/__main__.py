import sys
import argparse
import logging
from pathlib import Path
from .version import __version__
from . import backend
from .flattener import flatten_model
from .parser import ufsm_parse_model
from .optimizer import optimizer
from .c_generator import c_generator

def main():
    parser = argparse.ArgumentParser(description="uFSM generator")
    parser.add_argument("backend", help="Code generator backend")
    parser.add_argument("model", help="Input model")
    parser.add_argument("output_dir", help="Output directory")
    parser.add_argument(
        "-v",
        "--verbose",
        choices=(0, 1, 2),
        type=int,
        default=1,
        help=(
            "Control the verbosity; disable(0), warning(1) "
            "and debug(2) (default: %(default)s)."
        ),
    )

    parser.add_argument(
        "--version",
        action="version",
        version=__version__,
        help="Print version information and exit.",
    )

    args = parser.parse_args()

    levels = [logging.CRITICAL, logging.WARNING, logging.DEBUG]
    level = levels[args.verbose]

    logging.basicConfig(format="%(module)s: %(message)s", level=level)

    logger = logging.getLogger(__name__)

    logging.debug(f"ufsm-generate {__version__}")

    if not Path(args.model).is_file():
        logging.error(f"Could not open file {args.model}")
        return -1
    if not Path(args.output_dir).is_dir():
        logging.error(f"Could not open output directory {args.output_dir}")
        return -1

    backend = args.backend
    model_fn = args.model
    output_dir = args.output_dir
    verbosity = args.verbose

    hmodel = ufsm_parse_model(model_fn)
    fmodel = flatten_model(hmodel)
    #fmodel_optimized = optimizer(fmodel)

    c_generator(fmodel, hmodel,
            f"{args.output_dir}/{hmodel.name}.c",
            f"{args.output_dir}/{hmodel.name}.h",
    )
    return 0
