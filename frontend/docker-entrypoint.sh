#!/bin/sh

# Replace environment variables in the built JavaScript files
# This allows us to configure the app at runtime without rebuilding

if [ -n "$REACT_APP_API_URL" ]; then
    find /usr/share/nginx/html -name "*.js" -exec sed -i "s|REACT_APP_API_URL_PLACEHOLDER|$REACT_APP_API_URL|g" {} \;
fi

echo "Environment variables substituted successfully"