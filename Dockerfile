FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies first (needed for any potential builds)
RUN npm ci && npm cache clean --force

# Copy source files
COPY src/ ./src/
COPY .env* ./

# Create logs directory
RUN mkdir -p logs

# Simple health check that doesn't depend on external services
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 10000) + '/health-simple', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Expose port
EXPOSE 10000

# Start application with simple version
CMD ["node", "src/index-simple.js"]