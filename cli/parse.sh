#!/bin/bash
rm -rf node_modules
npm install
exec ./node_modules/.bin/ts-node cli.ts "$1"
