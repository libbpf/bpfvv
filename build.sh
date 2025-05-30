#!/bin/bash

set -euo pipefail

SERVE=${1:-}
NPM=${NPM:-npm}

rm -rf dist
$NPM install
./node_modules/.bin/tsc
cp index.html styles.css dist/

if [ -n "$SERVE" ]; then
    cd dist && python3 -m http.server 8000
fi
