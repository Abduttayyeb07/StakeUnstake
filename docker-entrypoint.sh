#!/bin/sh
set -e
# The /data bind mount's ownership comes from the host, not the image, so
# fix it here (as root) before dropping to the unprivileged node user.
mkdir -p /data
chown -R node:node /data
exec su-exec node "$@"
