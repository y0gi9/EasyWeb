# test
location = /test12345 {
    return 307 /test12345/;
}

location ^~ /test12345/ {
    set $easyweb_upstream_id "7";
    set $easyweb_original_uri $request_uri;
    set $easyweb_original_host $host;
    set $easyweb_auth_redirect "";
    auth_request_set $easyweb_auth_redirect $upstream_http_x_easyweb_auth_redirect;
    auth_request /__easyweb/proxy-auth;
    error_page 401 = @easyweb_auth_unauthorized;
    error_page 403 = @easyweb_auth_forbidden;
    proxy_pass http://google.com/;
    proxy_set_header Host google.com;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;

    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    # Authentication required
}
