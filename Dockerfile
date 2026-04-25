FROM ubuntu:24.04

ARG NODE_MAJOR=22
ARG USERNAME=node
ARG USER_UID=1000
ARG USER_GID=1000

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TZ=Asia/Shanghai

RUN printf '%s\n' \
        'Acquire::Retries "5";' \
        'Acquire::http::Timeout "30";' \
        'Acquire::https::Timeout "30";' \
        'Acquire::ForceIPv4 "true";' \
        > /etc/apt/apt.conf.d/99-build-retries \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        jq \
        less \
        locales \
        openssh-client \
        sudo \
        tzdata \
        vim \
    && locale-gen C.UTF-8 \
    && install -d -m 0755 /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @larksuite/cli \
    && if getent group ${USER_GID} >/dev/null; then \
        EXISTING_GROUP="$(getent group ${USER_GID} | cut -d: -f1)"; \
        if [ "${EXISTING_GROUP}" != "${USERNAME}" ]; then groupmod -n ${USERNAME} ${EXISTING_GROUP}; fi; \
    else \
        groupadd --gid ${USER_GID} ${USERNAME}; \
    fi \
    && if getent passwd ${USER_UID} >/dev/null; then \
        EXISTING_USER="$(getent passwd ${USER_UID} | cut -d: -f1)"; \
        if [ "${EXISTING_USER}" != "${USERNAME}" ]; then usermod -l ${USERNAME} -d /home/${USERNAME} -m ${EXISTING_USER}; fi; \
        usermod -g ${USER_GID} -s /bin/bash ${USERNAME}; \
    else \
        useradd --uid ${USER_UID} --gid ${USER_GID} -m ${USERNAME} -s /bin/bash; \
    fi \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${USERNAME} \
    && chmod 0440 /etc/sudoers.d/${USERNAME} \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/LarkProject

USER ${USERNAME}

CMD ["bash"]
