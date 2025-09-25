#!/bin/bash

# Check Render Deployment Status
# Usage: ./scripts/check-deployment.sh

echo "🚀 Checking BMA Messenger Hub Deployment Status..."
echo "=================================================="

# Check if service is responding
SERVICE_URL="https://bma-messenger-hub-ooyy.onrender.com"
HEALTH_ENDPOINT="$SERVICE_URL/health-simple"

echo "🔍 Checking health endpoint: $HEALTH_ENDPOINT"

# Test health endpoint
if curl -s --max-time 10 "$HEALTH_ENDPOINT" | grep -q '"status":"ok"'; then
    echo "✅ Service is healthy and responding"

    # Get service info
    echo ""
    echo "📊 Service Information:"
    curl -s "$SERVICE_URL" | jq '.' 2>/dev/null || curl -s "$SERVICE_URL"

else
    echo "❌ Service is not responding or unhealthy"
    echo ""
    echo "🔧 Troubleshooting steps:"
    echo "1. Check Render dashboard for deployment logs"
    echo "2. Verify environment variables are set"
    echo "3. Check if build process completed successfully"
    echo "4. Monitor resource usage (RAM/CPU)"
fi

echo ""
echo "🔗 Render Dashboard: https://dashboard.render.com/web/srv-csl9aoo56e95ggpks"
echo "📱 Service URL: $SERVICE_URL"
echo "🏥 Health Check: $HEALTH_ENDPOINT"