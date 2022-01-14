#!/bin/bash

docker run  -it --rm \
            -u $(id -u $USER) \
            -v $(readlink -f .):$(readlink -f .) \
            -v /home/${USER}:/home/${USER} \
            -v /etc/passwd:/etc/passwd \
            -v /etc/group:/etc/group \
            -v /tmp/.X11-unix:/tmp/.X11-unix \
            -e DISPLAY=$DISPLAY \
            -w ${PWD} ufsm_docker_env $@

