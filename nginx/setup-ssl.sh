#!/bin/sh

# Setup SSL certificates with Let's Encrypt
DOMAIN=${DOMAIN:-localhost}
EMAIL=${EMAIL:-admin@localhost}
STAGING=${SSL_STAGING:-false}

if [ "$DOMAIN" != "localhost" ] && [ "$DOMAIN" != "127.0.0.1" ]; then
    echo "Setting up Let's Encrypt SSL certificate for $DOMAIN"
    
    # Use staging server for testing
    if [ "$STAGING" = "true" ]; then
        STAGING_FLAG="--staging"
    else
        STAGING_FLAG=""
    fi
    
    # Request certificate
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        $STAGING_FLAG \
        -d $DOMAIN
    
    # Link certificates to nginx ssl directory
    if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
        ln -sf /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/nginx/ssl/cert.pem
        ln -sf /etc/letsencrypt/live/$DOMAIN/privkey.pem /etc/nginx/ssl/key.pem
        echo "Let's Encrypt certificate linked successfully"
        
        # Reload nginx
        nginx -s reload
    else
        echo "Failed to obtain Let's Encrypt certificate, using self-signed certificate"
    fi
else
    echo "Using self-signed certificate for $DOMAIN"
fi