#!/bin/bash

# EasyWeb Health Check Script
# Checks the health of all EasyWeb services

set -e

echo "🏥 EasyWeb Health Check"
echo "======================"
echo ""

# Check if Docker Compose services are running
echo "📋 Checking service status..."
if docker-compose ps | grep -q "Up"; then
    docker-compose ps
else
    echo "❌ No services are running"
    exit 1
fi

echo ""

# Check backend health
echo "🖥️  Checking backend health..."
if curl -f -s http://localhost:3001/health > /dev/null; then
    BACKEND_RESPONSE=$(curl -s http://localhost:3001/health)
    echo "✅ Backend is healthy"
    echo "   Status: $(echo $BACKEND_RESPONSE | jq -r '.status' 2>/dev/null || echo 'unknown')"
    echo "   Uptime: $(echo $BACKEND_RESPONSE | jq -r '.uptime' 2>/dev/null || echo 'unknown')s"
else
    echo "❌ Backend is unhealthy"
fi

echo ""

# Check frontend
echo "🌐 Checking frontend..."
if curl -f -s http://localhost:3000 > /dev/null; then
    echo "✅ Frontend is accessible"
else
    echo "❌ Frontend is not accessible"
fi

echo ""

# Check DNS service
echo "🌍 Checking DNS service..."
if nslookup google.com 127.0.0.1 > /dev/null 2>&1; then
    echo "✅ DNS service is responding"
else
    echo "❌ DNS service is not responding"
fi

echo ""

# Check Redis
echo "📝 Checking Redis..."
if docker-compose exec -T redis redis-cli ping | grep -q PONG; then
    echo "✅ Redis is responding"
else
    echo "❌ Redis is not responding"
fi

echo ""

# Check disk space
echo "💾 Checking disk space..."
DISK_USAGE=$(df -h . | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -lt 90 ]; then
    echo "✅ Disk usage is OK (${DISK_USAGE}%)"
else
    echo "⚠️  Disk usage is high (${DISK_USAGE}%)"
fi

echo ""

# Check memory usage
echo "🧠 Checking memory usage..."
if command -v free &> /dev/null; then
    MEMORY_USAGE=$(free | grep Mem | awk '{printf("%.0f", $3/$2 * 100)}')
    if [ $MEMORY_USAGE -lt 90 ]; then
        echo "✅ Memory usage is OK (${MEMORY_USAGE}%)"
    else
        echo "⚠️  Memory usage is high (${MEMORY_USAGE}%)"
    fi
else
    echo "ℹ️  Memory check not available on this system"
fi

echo ""

# Check log errors
echo "📋 Checking for recent errors..."
ERROR_COUNT=$(docker-compose logs --since=1h 2>&1 | grep -i error | wc -l)
if [ $ERROR_COUNT -eq 0 ]; then
    echo "✅ No errors in recent logs"
else
    echo "⚠️  Found $ERROR_COUNT errors in recent logs"
    echo "   Run 'docker-compose logs | grep -i error' for details"
fi

echo ""
echo "🏥 Health check completed"