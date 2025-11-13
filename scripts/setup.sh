#!/bin/bash

# EasyWeb Setup Script
# This script sets up EasyWeb for first-time installation

set -e

echo "🚀 Starting EasyWeb setup..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created. Please edit it with your configuration."
else
    echo "✅ .env file already exists."
fi

# Create data directories
echo "📁 Creating data directories..."
mkdir -p data/{blocklists,dns-logs}
mkdir -p ssl
chmod -R 755 data ssl

# Generate JWT secret if not set
if grep -q "your-super-secret-jwt-key" .env; then
    echo "🔐 Generating JWT secret..."
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    echo "✅ JWT secret generated."
fi

# Build containers
echo "🏗️  Building Docker containers..."
docker-compose build

# Initialize database
echo "💾 Initializing database..."
docker-compose up -d easyweb-backend redis
sleep 10
docker-compose exec easyweb-backend node -e "
const { initDatabase } = require('./src/config/database');
initDatabase().then(() => {
  console.log('Database initialized successfully');
  process.exit(0);
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
"
docker-compose down

echo ""
echo "✅ EasyWeb setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "1. Edit the .env file with your OAuth credentials"
echo "2. Set your domain name in the .env file (for SSL certificates)"
echo "3. Run 'npm run dev' for development or 'npm run prod' for production"
echo ""
echo "🔗 OAuth Setup Instructions:"
echo "- Google: https://console.cloud.google.com/"
echo "- GitHub: https://github.com/settings/developers"
echo "- Microsoft: https://portal.azure.com/"
echo ""
echo "📖 For detailed setup instructions, see README.md"