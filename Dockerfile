FROM ubuntu:focal

ENV TZ=Europe/Stockholm
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN echo "deb mirror://mirrors.ubuntu.com/mirrors.txt focal main restricted universe multiverse" > /etc/apt/sources.list && \
    echo "deb mirror://mirrors.ubuntu.com/mirrors.txt focal-updates main restricted universe multiverse" >> /etc/apt/sources.list && \
    echo "deb mirror://mirrors.ubuntu.com/mirrors.txt focal-security main restricted universe multiverse" >> /etc/apt/sources.list && \
    DEBIAN_FRONTEND=noninteractive apt-get update && \
    apt-get install -y \
    ca-certificates \
    build-essential \
    automake \
    autoconf-archive \
    autoconf \
    libtool \
    uuid-runtime \
    libjson-c-dev \
    uuid-dev \
    pkgconf \
    libgtk-3-0 \
    libgtk-3-dev \
&& rm -rf /var/lib/apt/lists/*

