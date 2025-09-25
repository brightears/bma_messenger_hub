FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies for faster builds
RUN npm ci --only=production && npm cache clean --force

# Copy source files
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Optimized health check with shorter intervals for faster deployment
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=2 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 10000) + '/health-simple', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

# Expose port
EXPOSE 10000

# Start application with simple version
CMD ["node", "src/index-simple.js"]