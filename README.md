# EasyWeb - Unified Network & Security Dashboard

A comprehensive web application that combines the functionality of nginx (reverse proxy), oauth2-proxy (authentication), and Pi-hole (DNS filtering) into a single, user-friendly management interface.

## Features

### 🔒 Authentication Gateway
- OAuth2/OIDC integration (Google, GitHub, Microsoft)
- JWT-based session management
- Role-based access control (admin/user)
- Secure cookie handling

### 🌐 DNS Filtering Engine
- Custom DNS server with Pi-hole-style ad/tracker blocking
- Configurable blocklist management with automatic updates
- Real-time query logging and analytics
- Whitelist/blacklist management
- Support for multiple blocklist formats (hosts, AdBlock, domain lists)

### 🔄 Reverse Proxy
- Dynamic upstream configuration
- SSL termination and automatic certificate management
- Path-based routing to internal services
- **Domain-only routing** - Direct domain mapping without path prefixes
- Health checking and load balancing
- Custom header injection
- Configurable authentication per upstream

### 📊 Management Dashboard
- Real-time DNS query monitoring with WebSocket updates
- Authentication logs and user management
- Proxy configuration and service status
- System metrics and performance graphs
- Comprehensive admin panel

## Architecture

- **Backend**: Node.js/Express API server with SQLite database
- **Frontend**: React SPA with TypeScript and Tailwind CSS
- **DNS Service**: Custom DNS server with filtering capabilities
- **Proxy**: Nginx with dynamic configuration
- **Real-time Updates**: WebSocket for live dashboard updates
- **Deployment**: Docker Compose for easy deployment

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Domain name (optional, for SSL certificates)

### Installation

1. **Clone and setup the project:**
```bash
cd EasyWeb
cp .env.example .env
```

2. **Configure environment variables in `.env`:**
```bash
# Basic configuration
DOMAIN=your-domain.com
EMAIL=admin@your-domain.com

# OAuth providers (configure at least one)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Generate a secure JWT secret
JWT_SECRET=your-super-secure-jwt-secret
```

3. **Start the application:**
```bash
# Development mode
npm run dev

# Production mode
npm run prod
```

4. **Access the application:**
- Web Interface: `https://your-domain.com` (or `http://localhost:3000` for development)
- API: `https://your-domain.com/api` (or `http://localhost:3001` for development)

### First-Time Setup

1. **Access the web interface** and log in with your OAuth provider
2. **The first user automatically becomes an admin**
3. **Configure DNS settings** in the Settings page
4. **Add proxy upstreams** for your internal services
5. **Customize blocklists** for DNS filtering

## Configuration

### OAuth Setup

#### Google OAuth
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth2 credentials
5. Add authorized redirect URI: `https://your-domain.com/api/auth/google/callback`

#### GitHub OAuth
1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Create new OAuth App
3. Authorization callback URL: `https://your-domain.com/api/auth/github/callback`

#### Microsoft OAuth
1. Go to [Azure Portal](https://portal.azure.com/)
2. Register new application
3. Add redirect URI: `https://your-domain.com/api/auth/microsoft/callback`

### DNS Configuration

1. **Point your devices to use EasyWeb DNS:**
   - Router: Set DNS server to your EasyWeb server IP
   - Individual devices: Configure DNS to your server IP

2. **Default blocklists are automatically configured:**
   - Steven Black Hosts
   - AdGuard DNS Filter
   - Additional lists can be added via the dashboard

### Local DNS Records

EasyWeb supports static DNS records that are resolved locally before queries are forwarded to upstream resolvers. This is perfect for internal network services, development environments, or custom domain mappings.

#### Features
- **Record Types**: A (IPv4), AAAA (IPv6), and CNAME records
- **TTL Support**: Configurable time-to-live (30-86400 seconds)
- **Enable/Disable**: Records can be toggled without deletion
- **Admin Control**: Only administrators can manage local records
- **Validation**: Automatic validation of IP addresses and hostnames

#### Managing Local Records

1. **Navigate to DNS → Local Records** in the dashboard
2. **Add a new record**:
   - Click "Add record" button
   - Enter the domain name (e.g., `service.local`)
   - Select record type (A, AAAA, or CNAME)
   - For A records: Enter IPv4 address (e.g., `192.168.1.100`)
   - For AAAA records: Enter IPv6 address (e.g., `2001:db8::1`)
   - For CNAME records: Enter target domain (e.g., `target.local`)
   - Set TTL (default: 300 seconds)
   - Add optional comment for documentation
   - Toggle "Enabled" status
3. **Edit existing records**:
   - Click "Edit" next to any record
   - Modify fields as needed
   - Save changes
4. **Toggle records**:
   - Use "Enable/Disable" to quickly activate/deactivate records
5. **Delete records**:
   - Click "Delete" to remove unwanted records

#### Use Cases

- **Internal Services**: Map `homeassistant.local` to your Home Assistant server
- **Development**: Point `dev.local` to your local development server
- **Network Devices**: Access routers or switches by name (e.g., `router.local`)
- **Load Balancing**: Create CNAME records for service discovery
- **Testing**: Override public domains for testing purposes

#### DNS Resolution Priority

Local records are resolved with the following priority:
1. **Local Records** - Static entries configured in EasyWeb
2. **Blocklists** - Domains blocked for security/ad-blocking
3. **Upstream Resolvers** - Forwarded to configured DNS servers

#### Notes

- Local records take precedence over blocklists and upstream DNS
- Records are loaded automatically when the DNS server starts
- Changes to local records require a DNS server restart to take effect
- Use `.local` domains to avoid conflicts with public TLDs
- CNAME records can point to other local records or public domains

### Proxy Configuration

EasyWeb ships with an opinionated nginx instance. The Proxy Management page lets you edit its path-based upstreams without touching config files manually.

#### Requirements
- The backend container must mount `/var/run/docker.sock` (already done in `docker-compose.yml`) so it can signal nginx.
- The shared config files default to `nginx/includes/proxy_upstreams.inc` (path-based locations) and `nginx/includes/proxy_servers.conf` (custom domains). Override with `NGINX_CONFIG_PATH` / `NGINX_SERVER_CONFIG_PATH` if you keep configs elsewhere.
- The default root handler lives in `nginx/includes/proxy_root.inc`. Override with `NGINX_ROOT_CONFIG_PATH` if you need a different include location.
- By default nginx is reloaded by signalling the `easyweb-nginx` container. Override with:
  - `NGINX_CONTAINER_NAME` to point at a different container name, or
  - `NGINX_RELOAD_COMMAND` to run a custom shell command (e.g. `docker exec easyweb-nginx nginx -s reload`).
  - Set `NGINX_DISABLE_DOCKER=true` if you only want the custom command.
- Localhost targets are rewritten to `host.docker.internal` so containers can reach your workstation. Set `NGINX_LOCALHOST_FORWARD_HOST` if you prefer a different name or IP.

#### Adding a service
1. Navigate to **Proxy → Upstreams** and click **Add Upstream**.
2. Fill in:
   - **Name** – friendly label shown in the dashboard.
   - **Path** – the public path segment, beginning with `/` (example: `/service`). **Optional when using custom domains**.
   - **Target URL** – where nginx should proxy traffic (examples: `https://cnn.com`, `http://localhost:3333`, `http://my-service:8080`). Localhost and non-TLD hosts are accepted.
   - **Custom Domains** – space or comma separated domain names (example: `myapp.local api.example.com`). When domains are specified, path becomes optional.
   - Optional toggles for **Enabled**, **Require Authentication**, and custom headers (JSON object).

#### Domain-Only Mode (New!)
EasyWeb now supports domain-only proxy configurations where you don't need to specify a path:

1. **Leave Path Empty**: When adding custom domains, you can leave the path field empty to create domain-only proxies.
2. **Direct Domain Mapping**: Requests to `myapp.local` go directly to your target service without any path prefix.
3. **Mixed Mode**: You can have both path-based (`/service`) and domain-based (`myapp.local`) access for the same service if desired.
4. **Use Cases**:
   - Production apps with dedicated domains
   - Development environments with local domains
   - Microservices with individual domain names
   - Migration from traditional web hosting

3. **Save Configuration**: The backend writes the new configuration immediately and stages it for nginx reload.
   - The generator automatically sets `proxy_set_header Host` to the upstream’s host (so CDNs accept the request). Enable **Preserve Host** in the advanced section if you prefer to forward the original client host header.
   - Paths are normalized so `/service` serves `/service/` and everything beneath it.
   - Targets that point to `localhost`, `127.0.0.1`, or `::1` are automatically rewritten to `host.docker.internal` so containers can reach your host machine. The `Host` header stays on `localhost` by default, so local dev servers keep working.
   - Custom domains entered in the advanced section generate full `server` blocks in `proxy_servers.conf`. Point those hostnames at the EasyWeb server (via DNS or `/etc/hosts`) and nginx handles them just like hand-written virtual hosts.
   - Optional **Allowed Emails** accepts a space or comma separated allowlist. Leave it blank to allow any authenticated user.

#### Previewing and applying changes
- Switch to the **Configuration** tab to review the generated nginx `location` blocks. The banner warns if the live file differs from the generated output.
- Click **Reload Nginx** to send a `HUP` signal to the nginx container (or run your custom command). Reload is only available to admins.
- Verify the route:
  1. `curl -I http://localhost/service` → Expect `307` redirecting to `/service/`.
  2. `curl -I http://localhost/service/` → Expect a response from the upstream (for CNN you’ll see a `301` to `https://www.cnn.com/`).
  3. Visit the same URL in a browser to double-check the content loads.
  4. If you added custom domains, add them to your DNS or `/etc/hosts` and repeat the same checks using the domain (`curl -I http://myapp.local` should hit your upstream).
  5. For local processes (e.g. `http://localhost:3333`), confirm they bind to your host interface; EasyWeb rewrites to `host.docker.internal` which points at the Docker host.

#### Pointing custom domains

To expose an upstream at `test2.y0gi.ca` or any other hostname:

1. Open the upstream form, expand **Advanced routing options**, add your domain(s), and save.
2. Click **Reload Nginx** on the Configuration tab so nginx picks up the new server block.
3. Choose one of the following network paths:
   - **Direct DNS (no Cloudflare):** create an `A`/`AAAA` record that points to your EasyWeb server’s IP (or add the domain to `/etc/hosts` while testing). Requests will flow straight to EasyWeb.
   - **With Cloudflare:** create the record in Cloudflare _and_ disable the proxy (grey cloud) until you confirm it works. If you keep the orange cloud enabled, ensure Cloudflare can reach the service (tunnel, public port, etc.) and provide a valid TLS certificate if you terminate SSL at EasyWeb.
 4. Verify with `curl -I http://test2.y0gi.ca/ --resolve test2.y0gi.ca:80:<EASYWEB_IP>` (or use HTTPS). Once DNS propagates, hitting the domain in a browser should proxy through EasyWeb.
     - When **Require Authentication** is enabled, the curl command must include a valid EasyWeb session cookie or you’ll receive `401`/`403` from nginx.

#### Updating or removing routes
- Use **Edit** to change paths, target URLs, or toggles. The config file is rewritten atomically with every change.
- Toggle **Enabled** off to keep a definition without exposing it.
- **Delete** removes the upstream from the database and the generated config.

#### Bulk import/export
- Use **Download JSON** to grab your current upstream definitions.
- Use **Import Configuration** to upload a JSON list (same shape as the export). Toggle “Replace existing” if you want to wipe current routes first.

> **Tip:** Paths are matched in nginx as written. Avoid overlapping prefixes (e.g. `/app` and `/app/api`) unless you understand nginx’s prefix-matching order.

## API Documentation

### Authentication Endpoints
- `GET /api/auth/google` - Google OAuth login
- `GET /api/auth/github` - GitHub OAuth login  
- `GET /api/auth/microsoft` - Microsoft OAuth login
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### DNS Management
- `GET /api/dns/stats` - DNS statistics
- `GET /api/dns/queries` - Recent DNS queries
- `GET /api/dns/blocklists` - Manage blocklists
- `PUT /api/dns/settings` - Update DNS settings

#### Local DNS Records (Admin Only)
- `GET /api/dns/local-records` - List all local DNS records
- `POST /api/dns/local-records` - Create new local DNS record
- `PUT /api/dns/local-records/:id` - Update existing local DNS record
- `DELETE /api/dns/local-records/:id` - Delete local DNS record

**Local Record Object:**
```json
{
  "id": 1,
  "domain": "service.local",
  "record_type": "A",
  "value": "192.168.1.100",
  "ttl": 300,
  "enabled": true,
  "comment": "Internal service",
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2025-01-01T00:00:00Z"
}
```

### Proxy Management
- `GET /api/proxy/upstreams` - List proxy upstreams
- `POST /api/proxy/upstreams` - Add new upstream
- `PUT /api/proxy/upstreams/:id` - Update upstream
- `DELETE /api/proxy/upstreams/:id` - Delete upstream

### Dashboard
- `GET /api/dashboard/stats` - Overall statistics
- `GET /api/dashboard/health` - System health check
- `GET /api/dashboard/users` - User management (admin only)

## Advanced Configuration

### Custom Blocklists

Add custom blocklists via the dashboard or API:

```bash
curl -X POST https://your-domain.com/api/dns/blocklists \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Custom Blocklist",
    "url": "https://example.com/blocklist.txt",
    "enabled": true
  }'
```

### SSL Certificates

EasyWeb automatically generates self-signed certificates for localhost. For production:

1. **Let's Encrypt (automatic):**
   - Set `DOMAIN` to your actual domain
   - Set `EMAIL` for Let's Encrypt notifications
   - Certificates are automatically obtained and renewed

2. **Custom certificates:**
   - Place certificates in `./ssl/` directory
   - Name them `cert.pem` and `key.pem`

### Performance Tuning

For high-traffic environments:

1. **Increase DNS cache size** in `dns-server/src/services/dnsResolver.js`
2. **Adjust batch sizes** for query logging
3. **Configure Redis** for better caching
4. **Scale with Docker Compose** using multiple instances

## Development

### Project Structure
```
EasyWeb/
├── backend/           # Node.js API server
├── frontend/          # React dashboard
├── dns-server/        # DNS filtering service
├── nginx/             # Reverse proxy configuration
├── docker-compose.yml # Container orchestration
└── README.md          # This file
```

### Development Setup

1. **Install dependencies:**
```bash
npm run install:all
```

2. **Start development servers:**
```bash
# All services
npm run dev

# Individual services
npm run backend:dev
npm run frontend:dev
npm run dns:dev
```

3. **Build for production:**
```bash
npm run build
```

## Troubleshooting

### Common Issues

1. **DNS not working:**
   - Check if port 53 is available
   - Verify upstream DNS servers are accessible
   - Check firewall settings

2. **Authentication failing:**
   - Verify OAuth credentials
   - Check redirect URLs match exactly
   - Ensure JWT_SECRET is set

3. **SSL certificate issues:**
   - Check domain DNS points to your server
   - Verify email for Let's Encrypt is correct
   - Check port 80 is accessible for HTTP challenges

### Logs

View logs for different services:

```bash
# All services
npm run logs

# Specific service logs
docker-compose logs easyweb-backend
docker-compose logs easyweb-dns
docker-compose logs nginx
```

### Health Checks

Check system health:
```bash
curl https://your-domain.com/api/dashboard/health
```

## Security Considerations

1. **Change default JWT secret** in production
2. **Use strong OAuth credentials** and keep them secret
3. **Enable HTTPS** for all communications
4. **Regular updates** of blocklists and dependencies
5. **Monitor logs** for suspicious activity
6. **Restrict admin access** to trusted users only

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions:
- Check the logs first
- Review this documentation
- Create an issue on GitHub with detailed information
