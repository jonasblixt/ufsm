import sys
import argparse
import logging
from pathlib import Path
from .version import __version__
from . import backend
from .ufsm_parser import UfsmParser
from .flattener import Flattener

def main():
    parser = argparse.ArgumentParser(description="uFSM compiler")
    parser.add_argument('backend', help='Code generator backend')
    parser.add_argument('model', help='Input model')
    parser.add_argument('output_dir', help='Output directory')
    parser.add_argument('-v', '--verbose',
                        choices=(0, 1, 2),
                        type=int,
                        default=1,
                        help=('Control the verbosity; disable(0), warning(1) '
                              'and debug(2) (default: %(default)s).'))

    parser.add_argument('--version',
                        action='version',
                        version=__version__,
                        help='Print version information and exit.')

    args = parser.parse_args()

    levels = [logging.CRITICAL, logging.WARNING, logging.DEBUG]
    level = levels[args.verbose]

    logging.basicConfig(format='%(levelname)s: %(message)s',
                        level=level)

    logger = logging.getLogger(__name__)

    logging.debug(f'ufsm-compile {__version__}')

    if not Path(args.model).is_file():
        logging.error(f'Could not open file {args.model}')
        return -1
    if not Path(args.output_dir).is_dir():
        logging.error(f'Could not open output directory {args.output_dir}')
        return -1

    backend = args.backend
    model_fn = args.model
    output_dir = args.output_dir
    verbosity = args.verbose

    # ufsm_parser = UfsmParser()
    # model = ufsm_parser.parse(...) -> Model()
    # 
    # flattener = ModelFlattener()
    # flat_model = flattener.flat(Model) -> FlatModel()
    #
    #

    ufsm_parser = UfsmParser()
    model = ufsm_parser.parse(model_fn)

    flattener = Flattener()
    flat_model = flattener.flat(model)
    return 0

if __name__ == "__main__":
    sys.exit(main())
