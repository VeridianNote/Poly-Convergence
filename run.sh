#!/usr/bin/env bash
echo "Building Poly Convergence..."
echo

npm run build
if [ $? -ne 0 ]; then
    echo
    echo "BUILD FAILED"
    exit 1
fi

echo
echo "Build successful! Output is in the build/ folder."
echo

npm run serve
