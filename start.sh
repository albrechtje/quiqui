#!/bin/sh
# Prevent git from prompting for credentials or opening a pager.
# Required when QuiQui clones public GitHub repos from within Node.js.
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=true
export GIT_PAGER=cat

exec node server.js
