#!/bin/bash

# EasyWeb Backup Script
# Creates a backup of configuration and data

set -e

BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="./backups"
BACKUP_FILE="easyweb_backup_${BACKUP_DATE}.tar.gz"

echo "📦 Creating EasyWeb backup..."

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create temporary backup directory
TEMP_BACKUP="/tmp/easyweb_backup_${BACKUP_DATE}"
mkdir -p "$TEMP_BACKUP"

echo "💾 Backing up configuration files..."
cp .env "$TEMP_BACKUP/" 2>/dev/null || echo "⚠️  .env file not found"
cp docker-compose.yml "$TEMP_BACKUP/"
cp -r nginx/conf.d "$TEMP_BACKUP/" 2>/dev/null || echo "⚠️  nginx conf.d not found"

echo "💾 Backing up data directory..."
if [ -d "data" ]; then
    cp -r data "$TEMP_BACKUP/"
else
    echo "⚠️  data directory not found"
fi

echo "💾 Backing up SSL certificates..."
if [ -d "ssl" ]; then
    cp -r ssl "$TEMP_BACKUP/"
else
    echo "⚠️  ssl directory not found"
fi

echo "💾 Exporting database..."
if docker-compose ps | grep -q easyweb-backend; then
    docker-compose exec -T easyweb-backend node -e "
    const { db } = require('./src/config/database');
    const fs = require('fs');
    
    async function exportData() {
      try {
        const users = await db()('users').select('*');
        const blocklists = await db()('dns_blocklists').select('*');
        const upstreams = await db()('proxy_upstreams').select('*');
        const settings = await db()('settings').select('*');
        
        const exportData = {
          export_date: new Date().toISOString(),
          users,
          blocklists,
          upstreams,
          settings
        };
        
        console.log(JSON.stringify(exportData, null, 2));
      } catch (error) {
        console.error('Export failed:', error);
        process.exit(1);
      }
    }
    
    exportData();
    " > "$TEMP_BACKUP/database_export.json"
    echo "✅ Database exported"
else
    echo "⚠️  EasyWeb backend not running, skipping database export"
fi

# Create compressed archive
echo "🗜️  Creating compressed backup..."
cd /tmp
tar -czf "$BACKUP_FILE" "easyweb_backup_${BACKUP_DATE}"
mv "$BACKUP_FILE" "$(pwd)/backups/"

# Clean up temporary directory
rm -rf "$TEMP_BACKUP"

echo "✅ Backup created: backups/$BACKUP_FILE"
echo ""
echo "📋 Backup contains:"
echo "- Configuration files (.env, docker-compose.yml)"
echo "- Data directory (blocklists, logs)"
echo "- SSL certificates"
echo "- Database export"
echo ""
echo "💡 To restore from backup:"
echo "   1. Extract the backup file"
echo "   2. Copy files back to their original locations"
echo "   3. Import database using the JSON file"