#!/bin/bash

# EasyWeb Update Script
# Updates EasyWeb to the latest version

set -e

echo "🔄 Starting EasyWeb update..."

# Check if backup is needed
if [ "$1" != "--no-backup" ]; then
    echo "📦 Creating backup before update..."
    ./scripts/backup.sh
fi

# Pull latest changes (if using git)
if [ -d ".git" ]; then
    echo "📡 Pulling latest changes from git..."
    git pull origin main
fi

# Stop services
echo "🛑 Stopping services..."
docker-compose down

# Rebuild containers
echo "🏗️  Rebuilding containers..."
docker-compose build --no-cache

# Update database schema if needed
echo "💾 Checking for database updates..."
docker-compose up -d easyweb-backend redis
sleep 10

# Run any database migrations here
# docker-compose exec easyweb-backend npm run migrate

docker-compose down

# Restart services
echo "🚀 Starting updated services..."
docker-compose up -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 30

# Check if services are healthy
echo "🏥 Checking service health..."
if curl -f -s http://localhost:3001/health > /dev/null; then
    echo "✅ Backend is healthy"
else
    echo "❌ Backend health check failed"
    exit 1
fi

if curl -f -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is healthy"
else
    echo "❌ Frontend health check failed"
    exit 1
fi

echo ""
echo "✅ EasyWeb update completed successfully!"
echo ""
echo "🔗 Access your updated EasyWeb at:"
echo "- Local: http://localhost:3000"
echo "- Domain: https://$(grep DOMAIN .env | cut -d'=' -f2)"
echo ""
echo "📋 Post-update checklist:"
echo "- Check that all services are running: docker-compose ps"
echo "- Verify DNS filtering is working"
echo "- Test proxy upstreams"
echo "- Check logs for any errors: docker-compose logs"