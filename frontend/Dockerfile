# Build stage
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (lockfile not checked in yet)
RUN npm install

# Copy source code
COPY . .

# Build the app
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built app to nginx
COPY --from=builder /app/build /usr/share/nginx/html

# Create a script to replace environment variables at runtime
RUN mkdir -p /docker-entrypoint.d
COPY docker-entrypoint.sh /docker-entrypoint.d/40-env-substitution.sh
RUN chmod +x /docker-entrypoint.d/40-env-substitution.sh

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
