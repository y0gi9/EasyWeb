FROM node:18-alpine

# Install necessary packages
RUN apk add --no-cache python3 make g++ sqlite

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY src/ ./src/

# Create directories for data persistence
RUN mkdir -p /app/data /app/blocklists /app/logs
RUN chown -R node:node /app

USER node

# Expose DNS port
EXPOSE 53/udp 53/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD nslookup google.com 127.0.0.1 || exit 1

# Start the DNS server
CMD ["npm", "start"]
